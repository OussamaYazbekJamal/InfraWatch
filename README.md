# InfraWatch — Senior Project

A civic infrastructure reporting platform for Lebanon that shifts ownership of regional infrastructure data from a single central authority to the municipalities themselves. Citizens report problems across six categories — electricity, fuel, roads, transportation, government offices, and health — through a single shared platform, assisted by AI-based severity suggestion, image classification, and location extraction. Municipalities own and maintain their own region's data through dedicated **Organization Lead** and **Organization Staff** roles, while an **Admin** role handles platform-wide oversight and organization onboarding.

Validated end-to-end across three demonstration regions: **Zahle**, **El Manara/Hammara**, and **Dahr El Ahmar**.

## Roles

InfraWatch has four distinct roles, each with a scoped set of permissions:

| Role | Scope |
|------|-------|
| **Citizen** (incl. signed-out "Ghost" browsing) | Browse infrastructure by category, use the live map, submit and track reports, confirm existing reports |
| **Org Staff** | Manage reports and infrastructure data scoped to their organization's jurisdiction, across all six categories |
| **Org Lead** | Provisioning/revoking Org Staff accounts, auditing staff activity, and read-only visibility into reports in the org's jurisdiction. Does **not** have Org Staff's report/civic-data *management* access — no status changes, no fuel/office/route/health/outage editing. The two roles are separate, not hierarchical (`/staff/*` and `/reports/lead-view` require `org_lead` specifically; the report-status and civic-data `/manage` routes require `org_staff` specifically) |
| **Admin** | Platform-wide report visibility, organization application review/approval |

## Project Structure

```
infrawatch/
├── backend/    → Node.js + Express API, PostgreSQL (via Supabase)
├── frontend/   → React web app (react-router, react-leaflet)
└── ml/         → Python ML service (text + image classification)
```

## Tech Stack

- **Backend:** Node.js with Express, PostgreSQL (hosted via Supabase), JWT-based authentication
- **Frontend:** React, react-router for navigation, react-leaflet for interactive mapping
- **ML:** XLM-RoBERTa (multilingual report-urgency text classification), MobileNetV2 (image classification, fine-tuned on RDD2022 for pothole/crack detection, ~0.78 macro F1), and a two-stage hybrid location extractor: fuzzy gazetteer matching (RapidFuzz, against a Lebanese place-name gazetteer built from OpenStreetMap) as the primary stage, falling back to a pretrained multilingual NER model (`Davlan/bert-base-multilingual-cased-ner-hrl`, Arabic/English/French LOC entities) for place-like mentions the gazetteer misses. Deliberately not fine-tuned — with a small dataset, NER is a harder task to fine-tune well than text classification, so an off-the-shelf pretrained model paired with a gazetteer that grows for free as OSM/Overpass coverage improves is the more appropriate low-data approach. Same-name places found more than 5km apart (haversine) are flagged as genuinely ambiguous and surfaced as alternative candidates for staff resolution, rather than silently auto-picking one
- **Email:** Nodemailer via Gmail SMTP (password resets, staff temp-password provisioning)
- **Third-party services:** Google Gemini (AI-generated PDF executive summaries, with a deterministic template fallback), OpenStreetMap Overpass API (live health facility data), OpenStreetMap Nominatim (reverse geocoding for organization jurisdiction setup), Open-Meteo (48h observed rainfall, cross-checked against citizen-reported flooding as a corroborating signal the image classifier can't otherwise detect)

See the project documentation's **Technology Constraints** section for the specific limitations and mitigations behind each of these (data-regime constraints on the classifiers, rate limits, geocoding precision, etc.).

## Quick Start

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, etc.
# Run schema.sql against your Supabase PostgreSQL instance first
npm run dev             # runs on port 5000
```

### 2. Frontend

```bash
cd frontend
npm install
npm start                # runs on port 3000, proxies API to :5000
```

### 3. ML Service

```bash
cd ml
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Environment Variables (backend/.env)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Supabase) |
| `JWT_SECRET` | Long random string for JWT signing |
| `CLIENT_URL` | React app URL, for CORS |
| `ML_SERVICE_URL` | Python ML service URL |
| `EMAIL_USER` / `EMAIL_APP_PASSWORD` | Nodemailer credentials for transactional email |
| `GEMINI_API_KEY` | Google Gemini API key, for AI-generated PDF summaries |
| `PORT` | Server port (default 5000) |

## Pages

| Route | Role | Description |
|---|---|---|
| `/` | All | Home — live category shortcuts and platform overview |
| `/electricity` | All | Outage data by district |
| `/fuel` | All | Fuel stations — live status and pricing |
| `/roads` | All | Citizen-reported road issues |
| `/transportation` | All | Transport routes maintained by organizations |
| `/offices` | All | Government offices and their status |
| `/health` | All | Verified health facilities by area |
| `/map` | All | Live map — all active reports and infrastructure entries |
| `/about` | All | Platform purpose and emergency contacts |
| `/report` | Citizen | Submit a report — category, description, AI severity suggestion, AI location extraction, image |
| `/my-reports` | Citizen | Track status of submitted reports |
| `/notifications` | Citizen | Status updates on submitted reports |
| `/login`, `/register` | Public | Auth |
| `/forgot-password` | Public | Reset-code + new-password flow |
| `/apply-as-organization` | Public | Municipality onboarding request |
| `/set-new-password` | Provisioned accounts | First-login temp-password change (Org Staff / Org Lead) |
| `/admin` | Admin | Reports (platform-wide) + Organizations (review/approve) |
| `/org/staff` | Org Staff | Reports (jurisdiction-scoped) + Fuel/Offices/Routes/Health/Outage management + PDF export |
| `/org/lead` | Org Lead | Staff Management + Reports (read-only, filterable and sortable by status/severity) + Staff Activity Log (dashboard summary) |

## API Endpoints

Extracted directly from `routes/index.js`. Base path: `/api`.

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Citizen registration |
| POST | `/auth/login` | Public | Login (all roles) |
| POST | `/auth/change-password` | Logged in | Change password |
| POST | `/auth/verify-phone` | Logged in | Verify OTP code |
| POST | `/auth/resend-otp` | Logged in | Resend OTP |
| POST | `/auth/forgot-password` | Public | Request reset code |
| POST | `/auth/reset-password` | Public | Reset password with code |

### Reports
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/reports` | Public | List reports |
| GET | `/reports/map` | Public | Map pin data |
| GET | `/reports/manage` | Org Staff | Reports in staff's jurisdiction (fuzzy district match against the org's `jurisdiction` — reports have no `organization_id`) |
| GET | `/reports/mine` | Logged in | The current citizen's own submitted reports |
| GET | `/reports/pdf-summary` | Org Staff | Generate the AI-summarized PDF regional report |
| GET | `/reports/:id` | Public | Single report |
| POST | `/reports/:id/confirm` | Logged in | Confirm an existing report |
| POST | `/reports` | Logged in | Submit report (multipart, `image` field) |
| PATCH | `/reports/:id/status` | Admin, or Org Staff in jurisdiction | Review report / update status |
| PATCH | `/reports/:id/location` | Logged in | Update report location |
| DELETE | `/reports/:id` | Admin | Delete report |

### Notifications
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | Logged in | Current user's own notifications |
| PATCH | `/notifications/:id/read` | Logged in | Mark one of the user's own notifications read |

### Organizations
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/geocode/preview?lat=&lng=` | Public | Live jurisdiction-name preview while placing a map pin (Apply as Organization form) |
| GET | `/organizations/jurisdictions` | Public | List approved jurisdictions |
| POST | `/organizations` | Public | Submit organization application |
| GET | `/organizations` | Admin | List all organizations |
| POST | `/organizations/:id/approve` | Admin | Approve organization |
| POST | `/organizations/:id/revoke` | Admin | Revoke organization |
| POST | `/organizations/:id/restore` | Admin | Restore a revoked organization |

### Org Staff Management
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/staff` | Org Lead | Provision new Org Staff account |
| GET | `/staff` | Org Lead | List org's staff |
| PATCH | `/staff/:id/revoke` | Org Lead | Revoke staff account |
| PATCH | `/staff/:id/restore` | Org Lead | Restore staff account |
| GET | `/staff/activity` | Org Lead | Org's staff activity log (last 200 actions) |
| GET | `/reports/lead-view` | Org Lead | Read-only view of reports in the org's jurisdiction — same jurisdiction fuzzy-match as `/reports/manage`, but no corresponding PATCH route, so status can't be changed from here |

### Civic Data — Fuel, Offices, Transport, Outage
These four follow an identical pattern: public read, staff-managed write, and a **claim-on-edit** model — an org_staff/org_lead editing an unclaimed row (`organization_id IS NULL`) automatically claims it for their org; deleting requires the row already be claimed first. Admin edits never change ownership.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/fuel`, `/offices`, `/transport`, `/outage` | Public | List (filterable — `brand`, `office_type`, `district`, etc.) |
| GET | `/fuel/map` | Public | Map pin data |
| GET | `/fuel/brands`, `/offices/types`, `/outage/districts` | Public | Distinct filter values |
| GET | `/fuel/manage`, `/offices/manage`, `/transport/manage`, `/outage/manage` | Org Staff | Own org's claimed rows + unclaimed rows matching their jurisdiction |
| POST | `/fuel`, `/offices`, `/transport`, `/outage` | Org Staff | Create (always under the logged-in staff's own org) |
| PATCH | `/fuel/:id`, `/offices/:id`, `/transport/:id`, `/outage/:id` | Org-scoped | Edit (claims if unclaimed) |
| DELETE | `/fuel/:id`, `/offices/:id`, `/transport/:id`, `/outage/:id` | Org-scoped | Delete (must already be claimed) |
| PATCH | `/transport/:id/status` | Admin | Update route status |

### Health
Staff-entered facilities are a supplement to a live public data source, not a replacement — `/health` merges both.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | Staff-entered health facilities (joined with organization name) |
| GET | `/health/nearby?lat=&lng=&type=` | Public | Live nearby facility lookup via OpenStreetMap Overpass |
| GET | `/health/manage` | Org Staff | Own org's staff-entered facilities |
| POST | `/health` | Org Staff | Create facility |
| PATCH | `/health/:id` | Org-scoped | Edit facility |
| DELETE | `/health/:id` | Org-scoped | Delete facility |

### ML / AI
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/ml/classify-text` | Public | Proxies to the ML service — binary urgency classification (urgent/not-urgent) + language detection + confidence, via XLM-RoBERTa |
| POST | `/ml/extract-location` | Public | Proxies to the ML service — location/place-name extraction from report text |
| POST | `/ml/classify-image` | Logged in | Proxies to the ML service — road-damage image classification (MobileNetV2), multipart `image` field |

### Weather
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/weather/flood-risk?lat=&lng=` | Public | Cross-checks 48h observed rainfall (Open-Meteo) against reported flooding — corroborating signal for a category the image classifier has no training data for |

## Next Steps

Per the project's documented Future Work:

1. Full national coverage beyond the current 3 demonstration regions
2. Geospatial polygon-based jurisdiction matching, replacing text-based matching at scale
3. Real SMS verification at registration (replacing the current demo-mode on-screen code)
4. Native mobile application
5. AI-powered hazard-aware trip planning (scoped out as a separate project)
6. Restaurant/food-safety reporting expansion
7. Finer-grained AI severity mapping using the classifier's existing confidence score
8. Search and filtering for health facilities as the verified dataset grows