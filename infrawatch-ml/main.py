"""
InfraWatch ML Service — FastAPI skeleton

Endpoints:
  POST /classify-text     -> XLM-R fine-tuned urgency classification (Lebanese reports)
  POST /extract-location  -> Hybrid gazetteer + NER location extraction
  POST /classify-image    -> MobileNetV2 fine-tuned on RDD2022 (pothole/crack/no_damage)

All three endpoints are live if their respective model/gazetteer files
are present; otherwise they degrade gracefully (dummy response for
classify-text/classify-image, 503 for extract-location).
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal, Optional

import io

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field
from torchvision import models, transforms
from transformers import AutoTokenizer

from train_classifier import MODEL_NAME, ReportClassifier  # reuse the model class from training
from location_extractor import LocationExtractor

TEXT_MODEL_PATH = "infrawatch_text_model.pt"  # produced by train_classifier.py
GAZETTEER_PATH = "gazetteer.csv"  # produced by build_gazetteer.py
IMAGE_MODEL_PATH = "infrawatch_image_model.pt"  # produced by train_image_classifier.py (trained on Colab)
IMAGE_SIZE = 224  # must match IMG_SIZE used in train_image_classifier.py
NUM_UNFROZEN_BLOCKS = 4  # must match training - only used to reconstruct the architecture before loading weights

# Maps the classifier's output label to a severity level for your existing
# report schema. Tune this if you want confidence to also factor in later
# (e.g. a low-confidence "pothole" call could be downgraded to "low").
IMAGE_LABEL_TO_SEVERITY = {
    "pothole": "high",
    "crack": "medium",
    "no_damage": "low",
}

# Populated at startup by the lifespan handler below. Loading once at
# startup (not per-request) is what keeps inference latency reasonable.
ml_models = {"tokenizer": None, "text_model": None, "label_classes": None, "device": None,
             "location_extractor": None, "image_model": None, "image_classes": None}


ARABIZI_WORDS = {
    "bl", "bel", "3ala", "3al", "3end", "3am", "mesh", "bas", "fi", "feeh",
    "hayda", "hayde", "kell", "kellon", "min", "men", "3an", "wa2e3", "sar",
    "taboor", "saff", "3adi", "khatir", "sghir", "kbir",
}


def detect_script(text: str) -> Literal["ar", "ar-LB", "en", "unknown"]:
    """
    Lightweight heuristic based on character script, not a real language
    classifier. Arabic-script text is tagged "ar" (covers both Fus'ha/MSA
    and dialect written in Arabic letters - CAMeLBERT-Mix handles both).
    Latin-script text is tagged "ar-LB" (Arabizi/Lebanese transliteration)
    if it contains Arabic-phoneme digits (2,3,5,7,8,9) OR common Lebanese
    Arabizi function words - a single digit occurrence is enough, since
    short real sentences often only have one. Plain Latin text with
    neither signal falls back to "en".
    """
    arabic_chars = sum(1 for ch in text if "\u0600" <= ch <= "\u06FF")
    if arabic_chars > len(text) * 0.3:
        return "ar"

    has_arabizi_digit = any(ch in "2378975" for ch in text)
    words = set(text.lower().replace(",", " ").replace(".", " ").split())
    has_arabizi_word = bool(words & ARABIZI_WORDS)

    if has_arabizi_digit or has_arabizi_word:
        return "ar-LB"

    if any(ch.isalpha() for ch in text):
        return "en"

    return "unknown"


def build_image_model(num_classes: int):
    """
    Reconstructs the exact same MobileNetV2 architecture used in
    train_image_classifier.py (Colab), so the saved state_dict loads
    correctly. Only the classifier head's output size actually needs to
    match your data - the frozen/unfrozen split doesn't matter for
    inference (no gradients are computed), but keeping it consistent
    avoids confusion if this code is ever reused for further training.
    """
    model = models.mobilenet_v2(weights=None)  # weights=None: we're loading our own fine-tuned weights, not ImageNet's
    model.classifier[1] = torch.nn.Linear(model.last_channel, num_classes)
    return model


IMAGE_TRANSFORM = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),  # ImageNet stats, same as training
])


@asynccontextmanager
async def lifespan(app: FastAPI):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ml_models["device"] = device
    try:
        checkpoint = torch.load(TEXT_MODEL_PATH, map_location=device)
        model = ReportClassifier(num_classes=checkpoint["num_classes"])
        model.load_state_dict(checkpoint["model_state_dict"])
        model.to(device)
        model.eval()

        ml_models["tokenizer"] = AutoTokenizer.from_pretrained(MODEL_NAME)
        ml_models["text_model"] = model
        ml_models["label_classes"] = checkpoint["label_classes"]
        print(f"Loaded fine-tuned text model from {TEXT_MODEL_PATH} ({checkpoint['label_classes']})")
    except FileNotFoundError:
        # Falls back to dummy responses below if no trained model exists yet.
        print(f"No trained model found at {TEXT_MODEL_PATH} - /classify-text will return dummy output.")

    try:
        ml_models["location_extractor"] = LocationExtractor(gazetteer_path=GAZETTEER_PATH)
        print(f"Loaded location extractor with gazetteer from {GAZETTEER_PATH}")
    except FileNotFoundError:
        print(f"No gazetteer found at {GAZETTEER_PATH} - /extract-location will be unavailable. "
              f"Run build_gazetteer.py first.")

    try:
        checkpoint = torch.load(IMAGE_MODEL_PATH, map_location=device)
        image_classes = checkpoint["classes"]
        image_model = build_image_model(num_classes=len(image_classes))
        image_model.load_state_dict(checkpoint["model_state_dict"])
        image_model.to(device)
        image_model.eval()

        ml_models["image_model"] = image_model
        ml_models["image_classes"] = image_classes
        print(f"Loaded fine-tuned image model from {IMAGE_MODEL_PATH} ({image_classes})")
    except FileNotFoundError:
        print(f"No trained image model found at {IMAGE_MODEL_PATH} - /classify-image will return dummy output.")

    yield


app = FastAPI(
    title="InfraWatch ML Service",
    description="Text and image classification microservice for InfraWatch reports",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow the React frontend (Vercel) and local dev to call this service.
# Tighten allow_origins to your actual deployed frontend URL(s) before production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: replace with ["https://your-frontend.vercel.app", "http://localhost:5173"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TextClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Report text, Arabic/Lebanese dialect or English")
    report_id: Optional[str] = Field(None, description="Optional ID of the report this text belongs to")


class TextClassifyResponse(BaseModel):
    urgency: Literal["urgent", "not_urgent"]
    confidence: float
    language_detected: Literal["ar", "ar-LB", "en", "unknown"]
    model_used: str
    processed_at: str


class ImageClassifyResponse(BaseModel):
    label: Literal["pothole", "crack", "no_damage", "unclassified"]
    confidence: float
    severity: Literal["low", "medium", "high"]
    model_used: str
    processed_at: str


class LocationExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Report text to scan for location mentions")
    report_id: Optional[str] = Field(None, description="Optional ID of the report this text belongs to")


class AlternativeCandidateResponse(BaseModel):
    lat: Optional[float] = None
    lon: Optional[float] = None
    place_type: Optional[str] = None


class LocationMatchResponse(BaseModel):
    text_span: str
    matched_name: str
    source: Literal["gazetteer", "ner"]
    confidence: float
    lat: Optional[float] = None
    lon: Optional[float] = None
    place_type: Optional[str] = None
    ambiguous: bool = False
    alternative_candidates: list[AlternativeCandidateResponse] = []


class LocationExtractResponse(BaseModel):
    matches: list[LocationMatchResponse]
    gazetteer_matches: int
    ner_only_matches: int
    processed_at: str


class HealthResponse(BaseModel):
    status: str
    service: str
    timestamp: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", response_model=HealthResponse, tags=["health"])
def root():
    return HealthResponse(
        status="ok",
        service="InfraWatch ML Service",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health_check():
    return HealthResponse(
        status="ok",
        service="InfraWatch ML Service",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/classify-text", response_model=TextClassifyResponse, tags=["classification"])
def classify_text(payload: TextClassifyRequest):
    """
    Classify a citizen report's text as urgent or not_urgent.

    TODO (handled once infrawatch_text_model.pt exists - see train_classifier.py):
      - Loads a CAMeL-BERT model fine-tuned for binary urgency classification
      - Preprocess Lebanese dialect text (normalization, transliteration handling)
      - Run inference and map model output -> urgency + confidence
    """
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="text field cannot be empty")

    model = ml_models["text_model"]
    tokenizer = ml_models["tokenizer"]

    if model is None or tokenizer is None:
        # No trained model on disk yet - fall back to the dummy stub so the
        # frontend keeps working while train_classifier.py hasn't been run.
        return TextClassifyResponse(
            urgency="not_urgent",
            confidence=0.65,
            language_detected=detect_script(payload.text),
            model_used="dummy-stub-v0",
            processed_at=datetime.now(timezone.utc).isoformat(),
        )

    device = ml_models["device"]
    encoding = tokenizer(
        payload.text,
        truncation=True,
        padding="max_length",
        max_length=64,
        return_tensors="pt",
    ).to(device)

    with torch.no_grad():
        logits = model(encoding["input_ids"], encoding["attention_mask"])
        probs = torch.softmax(logits, dim=1)
        confidence, predicted_idx = torch.max(probs, dim=1)

    predicted_label = ml_models["label_classes"][predicted_idx.item()]

    return TextClassifyResponse(
        urgency=predicted_label,
        confidence=round(confidence.item(), 4),
        language_detected=detect_script(payload.text),
        model_used=f"camelbert-finetuned-{TEXT_MODEL_PATH}",
        processed_at=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/extract-location", response_model=LocationExtractResponse, tags=["classification"])
def extract_location(payload: LocationExtractRequest):
    """
    Extract Lebanese place-name mentions from report text.

    Two-stage hybrid: fuzzy matching against a gazetteer of ~1900 Lebanese
    settlements built from OpenStreetMap (fast, returns coordinates), with
    a pretrained multilingual NER model as fallback for place-like words
    not in the gazetteer (returned without coordinates, for admin review).

    Intended use: cross-check against the map pin a user already selected
    in the report form - if the extracted location is far from the pin,
    flag the report for review rather than trusting either source blindly.
    """
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="text field cannot be empty")

    extractor = ml_models["location_extractor"]
    if extractor is None:
        raise HTTPException(
            status_code=503,
            detail=f"Location extractor unavailable - gazetteer not found at {GAZETTEER_PATH}. "
                    f"Run build_gazetteer.py first.",
        )

    result = extractor.extract(payload.text)

    return LocationExtractResponse(
        matches=[
            LocationMatchResponse(
                text_span=m.text_span,
                matched_name=m.matched_name,
                source=m.source,
                confidence=round(m.confidence, 2),
                lat=m.lat,
                lon=m.lon,
                place_type=m.place_type,
                ambiguous=m.ambiguous,
                alternative_candidates=[
                    AlternativeCandidateResponse(**alt) for alt in m.alternative_candidates
                ],
            )
            for m in result.matches
        ],
        gazetteer_matches=result.gazetteer_matches,
        ner_only_matches=result.ner_only_matches,
        processed_at=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/classify-image", response_model=ImageClassifyResponse, tags=["classification"])
async def classify_image(file: UploadFile = File(...)):
    """
    Classify an uploaded road/infrastructure photo for damage type and severity.

    Scope note: the model is trained on RDD2022 and only reliably covers
    "pothole" and "crack" (validation macro F1 ~0.78) - it has never seen
    flooding, collapsed sections, or missing signage, since no suitable
    training data exists for those categories. Reports in those categories
    should continue to rely on the user's own category selection and
    admin review rather than this endpoint's output.
    """
    allowed_types = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Allowed: {', '.join(allowed_types)}",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    model = ml_models["image_model"]
    image_classes = ml_models["image_classes"]

    if model is None or image_classes is None:
        # No trained model on disk yet - fall back to the dummy stub so the
        # frontend keeps working while train_image_classifier.py hasn't been run.
        return ImageClassifyResponse(
            label="unclassified",
            confidence=0.0,
            severity="medium",
            model_used="dummy-stub-v0",
            processed_at=datetime.now(timezone.utc).isoformat(),
        )

    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image file - it may be corrupted.")

    device = ml_models["device"]
    input_tensor = IMAGE_TRANSFORM(image).unsqueeze(0).to(device)

    with torch.no_grad():
        logits = model(input_tensor)
        probs = torch.softmax(logits, dim=1)
        confidence, predicted_idx = torch.max(probs, dim=1)

    predicted_label = image_classes[predicted_idx.item()]
    confidence_value = round(confidence.item(), 4)

    # Low-confidence predictions are reported as "unclassified" rather than
    # forcing a guess - an admin reviewing "unclassified, 42% confidence"
    # knows to look at the photo themselves, rather than trusting a shaky
    # automatic label.
    LOW_CONFIDENCE_THRESHOLD = 0.5
    if confidence_value < LOW_CONFIDENCE_THRESHOLD:
        final_label = "unclassified"
        severity = "medium"
    else:
        final_label = predicted_label
        severity = IMAGE_LABEL_TO_SEVERITY.get(predicted_label, "medium")

    return ImageClassifyResponse(
        label=final_label,
        confidence=confidence_value,
        severity=severity,
        model_used=f"mobilenetv2-finetuned-{IMAGE_MODEL_PATH}",
        processed_at=datetime.now(timezone.utc).isoformat(),
    )


# ---------------------------------------------------------------------------
# Local dev entrypoint: `python main.py`
# For production (Render, etc.) use: uvicorn main:app --host 0.0.0.0 --port $PORT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)