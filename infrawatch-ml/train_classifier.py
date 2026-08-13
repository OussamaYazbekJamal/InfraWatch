"""
train_classifier.py — Fine-tune CAMeL-BERT (dialectal Arabic) for
InfraWatch report classification, adapted for a SMALL dataset.

Low-data-regime choices made here (worth citing in your report):
  1. Partial fine-tuning: only the top N transformer layers + classifier
     head are trainable. The rest of CAMeL-BERT stays frozen, which
     drastically reduces the number of trainable parameters and the
     risk of overfitting on a small sample.
  2. k-fold cross-validation instead of a single train/test split, so
     you get a mean +/- std accuracy/F1 that's statistically meaningful
     even with few examples.
  3. Class-weighted loss, in case some categories (e.g. fuel_shortage)
     have fewer examples than others (e.g. pothole).

Usage:
    python train_classifier.py --data augmented_data.csv --epochs 8 --folds 5

Requires:
    pip install torch transformers scikit-learn pandas numpy
"""

import argparse

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_class_weight
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModel, AutoTokenizer

MODEL_NAME = "xlm-roberta-base"  # multilingual: handles Arabic (MSA/dialect), French, and English
                                   # code-switching common in Lebanese reports. Trade-off: less
                                   # specialized on pure Arabic dialect nuance than CAMeLBERT-Mix,
                                   # but doesn't break on French/English text or mixed-language sentences.
NUM_UNFROZEN_LAYERS = 2  # only fine-tune the top N encoder layers


class ReportDataset(Dataset):
    def __init__(self, texts, labels, tokenizer, max_length=64):
        self.texts = texts
        self.labels = labels
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        encoding = self.tokenizer(
            self.texts[idx],
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt",
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(0),
            "attention_mask": encoding["attention_mask"].squeeze(0),
            "label": torch.tensor(self.labels[idx], dtype=torch.long),
        }


class ReportClassifier(nn.Module):
    """CAMeL-BERT encoder + linear classification head, with most of the
    encoder frozen so training is stable on a small dataset."""

    def __init__(self, num_classes: int, num_unfrozen_layers: int = NUM_UNFROZEN_LAYERS):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(MODEL_NAME)
        hidden_size = self.encoder.config.hidden_size

        # Freeze everything first, then unfreeze the top N layers.
        for param in self.encoder.parameters():
            param.requires_grad = False

        total_layers = len(self.encoder.encoder.layer)
        for layer in self.encoder.encoder.layer[total_layers - num_unfrozen_layers:]:
            for param in layer.parameters():
                param.requires_grad = True

        self.dropout = nn.Dropout(0.2)
        self.classifier = nn.Linear(hidden_size, num_classes)

    def forward(self, input_ids, attention_mask):
        outputs = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        pooled = outputs.last_hidden_state[:, 0, :]  # [CLS] token representation
        return self.classifier(self.dropout(pooled))


def train_one_fold(model, train_loader, val_loader, class_weights, device, epochs, lr=2e-5):
    optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=lr)
    criterion = nn.CrossEntropyLoss(weight=class_weights.to(device))

    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        for batch in train_loader:
            optimizer.zero_grad()
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["label"].to(device)

            logits = model(input_ids, attention_mask)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        print(f"    epoch {epoch + 1}/{epochs} - train loss: {total_loss / len(train_loader):.4f}")

    # Validation
    model.eval()
    all_preds, all_labels = [], []
    with torch.no_grad():
        for batch in val_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["label"].to(device)

            logits = model(input_ids, attention_mask)
            preds = torch.argmax(logits, dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())

    return all_preds, all_labels


def main():
    parser = argparse.ArgumentParser(description="Fine-tune CAMeL-BERT for InfraWatch report classification.")
    parser.add_argument("--data", required=True, help="CSV with columns: text, label")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--output-model", default="infrawatch_text_model.pt")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    df = pd.read_csv(args.data)
    label_encoder = LabelEncoder()
    df["label_id"] = label_encoder.fit_transform(df["label"])
    num_classes = len(label_encoder.classes_)
    print(f"Classes: {list(label_encoder.classes_)}")
    print(f"Dataset size: {len(df)}")

    # GroupKFold prevents near-duplicate rows (e.g. the same template with
    # only the location/time swapped, or back-translated paraphrases of the
    # same original sentence) from ending up split across train and
    # validation within a fold - that leakage is what previously produced
    # unrealistically high, unrealistically stable F1 scores. Rows without
    # a group_id (e.g. hand-written real reports with no known duplicates)
    # each get their own unique group so they're treated independently.
    if "group_id" not in df.columns:
        print("WARNING: no group_id column found - treating every row as its own "
              "group. If your data has near-duplicates (templates, back-translation "
              "augmentation), add a group_id column or your CV score may be inflated.")
        df["group_id"] = [f"row_{i}" for i in range(len(df))]
    else:
        df["group_id"] = df["group_id"].fillna(pd.Series([f"row_{i}" for i in range(len(df))]))

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

    class_weights = compute_class_weight(
        class_weight="balanced",
        classes=np.arange(num_classes),
        y=df["label_id"].values,
    )
    class_weights = torch.tensor(class_weights, dtype=torch.float)

    # Guard: GroupKFold needs at least `folds` distinct groups.
    n_groups = df["group_id"].nunique()
    n_folds = min(args.folds, n_groups)
    if n_folds < args.folds:
        print(f"WARNING: only {n_groups} distinct groups found. "
              f"Reducing folds from {args.folds} to {n_folds}.")

    gkf = GroupKFold(n_splits=n_folds)
    texts = df["text"].values
    labels = df["label_id"].values
    groups = df["group_id"].values

    fold_f1_scores = []
    best_model_state = None
    best_f1 = -1

    for fold, (train_idx, val_idx) in enumerate(gkf.split(texts, labels, groups)):
        print(f"\n=== Fold {fold + 1}/{n_folds} ===")
        train_texts, val_texts = texts[train_idx], texts[val_idx]
        train_labels, val_labels = labels[train_idx], labels[val_idx]

        train_ds = ReportDataset(train_texts, train_labels, tokenizer)
        val_ds = ReportDataset(val_texts, val_labels, tokenizer)
        train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
        val_loader = DataLoader(val_ds, batch_size=args.batch_size)

        model = ReportClassifier(num_classes=num_classes).to(device)
        preds, true_labels = train_one_fold(model, train_loader, val_loader, class_weights, device, args.epochs)

        fold_f1 = f1_score(true_labels, preds, average="macro", zero_division=0)
        fold_f1_scores.append(fold_f1)
        print(f"    fold {fold + 1} macro F1: {fold_f1:.4f}")
        print(classification_report(
            true_labels, preds,
            target_names=label_encoder.classes_,
            zero_division=0,
        ))

        if fold_f1 > best_f1:
            best_f1 = fold_f1
            best_model_state = model.state_dict()

    print("\n=== Cross-validation summary ===")
    print(f"Macro F1 across {n_folds} folds: {np.mean(fold_f1_scores):.4f} +/- {np.std(fold_f1_scores):.4f}")

    # Save the best-performing fold's model + label encoder classes for inference
    torch.save({
        "model_state_dict": best_model_state,
        "label_classes": list(label_encoder.classes_),
        "num_classes": num_classes,
    }, args.output_model)
    print(f"\nBest model (fold F1={best_f1:.4f}) saved to {args.output_model}")


if __name__ == "__main__":
    main()
