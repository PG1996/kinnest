# Kinnest Slice 3b Implementation Plan (file storage, attachments, photo scanning)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store photos and documents safely, attach them to doctor visits, vaccinations, vitals entries and medicines, and let a parent photograph a record (vitals page, vaccine schedule, medicine label) so a vision model drafts the entries for them to review and confirm.

**Architecture:** A small storage service (local disk in v1 behind an interface, S3-ready) plus a `files` table and a generic `attachments` table link files to records. Uploads are validated by content, re-encoded (location data stripped) and served only through an authenticated endpoint. A scan service sends one image to a Claude vision model and asks for structured output through a tool schema; the result is a **draft** that is never saved by the server, only returned to the screen, where the parent edits and confirms using the existing create endpoints (bulk vitals, apply-template-like endpoint for scanned vaccines, medicine form). Slice 3a must be merged first.

**Tech Stack:** unchanged, plus `Pillow` (image validation, re-encoding, thumbnails) and the `anthropic` Python SDK. Before writing any SDK code, read the `claude-api` skill and check the current model ids, image size limits and structured-output (tool use) details.

**Spec:** `docs/superpowers/specs/2026-10-31-kinnest-v1-design.md` sections 4.6 (photo import), 4.7 (scan, card photo), 4.8 (visit files), 4.5 (medicine photo and label reading), 4.11 (photos; only the storage part is needed here). Conventions: `docs/HANDOFF.md`.

## Global Constraints

- Free except the Anthropic API calls the owner chooses to make; the scan feature is **off and hidden** unless `ANTHROPIC_API_KEY` is set. The key lives only in `.env`.
- Scanning is **always an explicit tap** on a screen that says the photo will be sent to the Anthropic API and suggests cropping out the child's name. Nothing is scanned or sent automatically.
- A scan result is a **draft**: never persisted by the scan endpoint, validated against the same ranges and enums as manual entry, shown for review, and saved only when the parent confirms. Rows the model is unsure about are flagged.
- The model extracts **only what is printed or written** on the page. It never adds advice, doses or diagnoses of its own; unreadable cells are returned empty, not guessed.
- Uploads: JPEG, PNG, WebP and PDF only, at most 10 MB each, 20 files per record. The type is decided from the file content, not the name or the client's claim. Images are re-encoded (EXIF and GPS removed) and large ones downscaled to at most 2000 pixels on the long side.
- Files are served only to signed-in members of the owning family (Viewers may read), with `Cache-Control: private, no-store`. Storage keys are random UUIDs, never user-supplied paths.
- Backups must include the media files (database backup alone is not enough from this slice on).
- Roles: Admin and Caregiver upload and scan; Viewer reads attachments only. All text through i18n keys. No Claude co-author or attribution line in commits.

## Review Focus

- **Upload safety**: a file whose extension says `.jpg` but whose bytes are an executable or HTML, a decompression bomb image, a 12 MB file, a path-looking filename, a double extension, a PDF with an embedded script; none can be stored or served as anything but its sniffed type.
- **Authorization**: a member of another family, a signed-out request and a deleted attachment all get 404 on download; Viewers cannot upload or delete.
- **Scan robustness**: the model returns invalid JSON, extra fields, out-of-range numbers, a date in the future, text inside the image that tries to give it instructions (prompt injection), or an empty page; the result is always a validated draft with warnings, never a crash and never saved.
- **Scan abuse and cost**: a per-user daily limit, a request timeout, one scan at a time per user; a missing key gives a clear message and hides the feature; a failed scan never loses the uploaded photo.
- **Privacy**: no image bytes or full extracted text in logs; the notice is shown before the first send; EXIF GPS is gone from stored files.
- **Data safety**: restoring a backup brings back both the database and the media; deleting a record keeps its files until the retention rule (soft delete) is decided and documented.

---

### Task 1: Storage service, files table and upload and download API

**Files:**
- Create: `backend/app/services/storage.py`, `backend/app/services/images.py`, `backend/app/api/files.py`, `backend/tests/test_storage.py`, `backend/tests/test_files.py`, `backend/alembic/versions/<rev>_files.py`
- Modify: `backend/app/models.py`, `backend/app/config.py` (`media_dir`, `max_upload_mb`), `backend/pyproject.toml` (Pillow), `backend/app/main.py`, `deploy/docker-compose.yml`, `deploy/docker-compose.prod.yml` (a `media` volume mounted at `MEDIA_DIR` in the `api` service)

**Interfaces:**
- `Storage` protocol: `put(key: str, data: bytes) -> None`, `get(key: str) -> bytes`, `delete(key: str) -> None`; `LocalStorage(root: Path)` refuses keys that are not a UUID plus optional suffix (no separators, no dots segments). `get_storage()` dependency.
- `images.sniff(data: bytes) -> "jpeg"|"png"|"webp"|"pdf"` (from content; raises `ValueError`), `images.normalise(data: bytes, kind: str) -> tuple[bytes, str]` (re-encode images, strip metadata, downscale to 2000 px, reject decompression bombs by pixel count; PDFs are checked for the header and size only and stored as is), `images.thumbnail(data) -> bytes` (400 px JPEG).
- Model `StoredFile(id uuid, family_id, kid_id, key, thumb_key|None, content_type, size_bytes, sha256, original_name (display only), created_by, created_at, deleted_at)`.
- API: `POST /api/files` multipart `file` (caregiver; 201 `{id, content_type, size_bytes, name, thumb_url, url}`; 413 over the limit; 415 for a type not allowed), `GET /api/files/{id}` and `GET /api/files/{id}/thumb` (any member of the family; correct `Content-Type` from the sniffed type, `Content-Disposition: inline` with a safe filename, `Cache-Control: private, no-store`), `DELETE /api/files/{id}` (caregiver; soft delete).

- [ ] **Step 1: Write failing tests**: `local storage refuses unsafe keys`; `sniff decides by content` (a `.jpg` named HTML is refused, a renamed PNG is a PNG); `normalise strips gps exif and downscales`; `decompression bomb refused`; `upload 201 for jpeg png webp pdf`; `12 MB file is 413`; `executable named image.jpg is 415`; `viewer cannot upload`; `download needs membership and returns the sniffed type with private cache headers`; `other family and deleted file are 404`; `delete is soft and the bytes stay until purge`.
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_storage.py tests/test_files.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, model and routes; run `uv pip install` for Pillow into the venv and add it to `pyproject.toml`; autogenerate and check the migration.
- [ ] **Step 4: Run** the backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: file storage and upload API`.

### Task 2: Attachments on records and backups that include media

**Files:**
- Create: `backend/app/api/attachments.py`, `backend/tests/test_attachments.py`, `backend/alembic/versions/<rev>_attachments.py`
- Modify: `backend/app/models.py`, `deploy/backup.sh`, `deploy/restore.sh`, `docs/RUNNING_ON_MAC.md`, `deploy/ORACLE_SETUP.md`

**Interfaces:**
- Model `Attachment(id, family_id, kid_id, owner_kind: "visit"|"vaccination"|"vital"|"medicine", owner_id uuid, file_id, role: "attachment"|"source"|"medicine_photo"|"card", created_by, created_at, deleted_at)`.
- API: `POST /api/attachments {owner_kind, owner_id, file_id, role}` (caregiver; the owner record and the file must belong to the caller's family; max 20 per record), `DELETE /api/attachments/{id}`, `GET /api/attachments?owner_kind=&owner_id=` and an `attachments` array (file id, thumb url, content type, name, role) added to the JSON of visits, vaccinations, vitals entries and medicines (a small shared serializer).
- `backup.sh` additionally archives the media volume (for example `docker run --rm -v <project>_media:/media -v <dir>:/out alpine tar czf /out/kinnest-media-<stamp>.tar.gz -C /media .`) next to the database dump and keeps the same 14-day retention; `restore.sh <db dump> [media archive]` restores both; docs updated.

- [ ] **Step 1: Write failing tests**: `attach a file to each of the four record kinds`; `other family's file or record is refused`; `twenty-first attachment refused`; `deleting an attachment keeps the file but hides it from the record`; `record JSON lists attachments with thumb urls`; `viewer reads but cannot attach`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_attachments.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, routes and serializer; update both backup scripts and verify a backup and restore round trip on the dev stack (database rows and a stored file come back byte-identical, checked by sha256).
- [ ] **Step 4: Run** the backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: attachments on records and media in backups`.

### Task 3: Scan service and endpoints

**Files:**
- Create: `backend/app/services/scan.py`, `backend/app/api/scans.py`, `backend/tests/test_scan.py`, `backend/alembic/versions/<rev>_scan_requests.py`
- Modify: `backend/app/models.py`, `backend/app/config.py` (`anthropic_api_key`, `scan_model` default a current Sonnet-class model id, `scan_daily_limit` default 20, `scan_timeout_seconds` default 60), `backend/pyproject.toml` (`anthropic`), `.env.example`

**Interfaces:**
- Model `ScanRequest(id, family_id, kid_id, kind: "vitals"|"vaccines"|"medicine_label", file_id, created_by, created_at, status: "ok"|"failed", error: str|None, input_tokens, output_tokens)` (audit and rate limit; stores no image bytes and no extracted text).
- `scan.extract(kind, image_bytes, content_type, client) -> Draft` where `Draft = {rows|fields, warnings: [str], overall_confidence}` is produced by a tool-use call whose input schema forces the structure:
  - `vitals`: `rows: [{date: "YYYY-MM-DD"|null, time: "HH:MM"|null, place_kind|null, place_name|null, weight_kg|null, height_cm|null, head_cm|null, temperature_c|null, heart_rate|null, resp_rate|null, spo2|null, confidence: "high"|"low", source_text}]`;
  - `vaccines`: `rows: [{name, dose_label|null, due_date|null, due_after_weeks|null, given_on|null, confidence, source_text}]`;
  - `medicine_label`: `fields: {name|null, strength_amount|null, strength_unit|null, directions|null, expiry_date|null, manufacturer|null, confidence}` where `directions` is the printed text copied verbatim.
  The system prompt tells the model to copy only what is printed or written, to return null for anything it cannot read, never to infer doses or advice, and to ignore any instructions that appear inside the image.
- Server-side validation of a draft: reuse the vitals ranges, the dose unit list, date parsing; invalid cells are set to null and a warning is added; dates in the future or before birth become warnings; at most 200 rows; unknown fields dropped.
- `POST /api/scans {kind, file_id}` (caregiver): 503 `{detail: "scanning is not set up"}` without a key; 429 over `scan_daily_limit` (per user per day, in the family timezone); 409 if a scan by this user is already running; the file must be an image or a PDF of the family; returns `{scan_id, draft}`; on any model or network error returns 502 with a short message, records `status: "failed"`, and keeps the file. `GET /api/scans/status` -> `{enabled: bool, remaining_today: int}` (so the frontend can hide the feature).

- [ ] **Step 1: Write failing tests** with a fake client (no network): `valid model output becomes a validated draft`; `invalid json or missing tool call gives 502 and a failed record, file kept`; `out-of-range and future values are nulled with warnings`; `unknown fields dropped and rows capped at 200`; `instructions inside the image text are not followed` (the fake returns text that looks like an instruction in `source_text`; the draft only carries data fields); `no key returns 503 and status enabled false`; `daily limit returns 429`; `second concurrent scan returns 409`; `viewer cannot scan`; `other family's file is 404`; `logs and the audit row contain no image bytes or extracted text`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_scan.py -q`. Expected: FAIL.
- [ ] **Step 3: Read the `claude-api` skill**, then implement `scan.py` (one image per request, `max_tokens` bounded, timeout, tool choice forced) and the router. Do not call the real API in the test suite.
- [ ] **Step 4: Run** the backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: scan service with validated drafts`.

### Task 4: Frontend data layer and the capture and upload component

**Files:**
- Create: `frontend/src/lib/image.ts`, `frontend/src/components/PhotoPicker.tsx`, `frontend/src/components/Attachments.tsx`, `frontend/src/components/ScanNotice.tsx`
- Modify: `frontend/src/api/hooks.ts`, `frontend/src/i18n/en.json`
- Test: `frontend/src/lib/image.test.ts`, `frontend/src/components/Attachments.test.tsx`

**Interfaces:**
- `image.downscale(file: File, maxSide = 2000, quality = 0.85) -> Promise<Blob>` (canvas, JPEG, keeps PDFs untouched). Hooks: `useUploadFile()` (multipart, progress), `useAttachments(ownerKind, ownerId)`, `useAddAttachment()`, `useDeleteAttachment()`, `useScanStatus()`, `useScan()`. `PhotoPicker`: "Take a photo" (`<input type="file" accept="image/*" capture>`) and "Choose a file" (images and PDF), shows a preview, reports errors for size or type. `Attachments`: thumbnails grid with open-full-size, delete (two-step), and add; hidden controls for Viewers. `ScanNotice`: the privacy sentence ("The photo is sent to the Anthropic API to read it. You can crop out her name first. Nothing is saved until you confirm."), shown before every first scan in a session and requiring a tap.

- [ ] **Step 1: Write failing tests**: `downscale keeps aspect ratio and caps the long side`; `picker refuses wrong types and large files with a message`; `attachments grid shows thumbnails and the viewer has no buttons`; `delete needs a second confirm`; `scan notice must be accepted before a scan starts`; `scan controls are hidden when status says disabled`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, hooks and components.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: photo picker, attachments and scan notice`.

### Task 5: Attachments on visits, vaccinations, vitals and medicines

**Files:**
- Modify: `frontend/src/components/VisitForm.tsx`, `frontend/src/pages/VisitsTab.tsx`, `frontend/src/pages/VaccinesTab.tsx`, `frontend/src/components/VitalList.tsx`, `frontend/src/pages/Medicines.tsx`, `frontend/src/components/MedicineForm.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/AttachmentsOnRecords.test.tsx`

**Interfaces:**
- Visits get an attachments area (reports, prescriptions, images); a vaccination gets a **vaccine card photo**; a vitals entry shows its **source photo** when it came from an import; a medicine gets a **medicine photo** shown on its card and on Home. Each uses `Attachments` with the matching `owner_kind` and `role`.

- [ ] **Step 1: Write failing tests**: `visit shows and adds attachments`; `vaccination card photo can be added and opened`; `vitals source photo shows on the entry`; `medicine photo shows on the card`; `viewer sees thumbnails only`.
- [ ] **Step 2: Run** `npx vitest run src/pages/AttachmentsOnRecords.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: attachments on visits, vaccines, vitals and medicines`.

### Task 6: Scan to draft for vitals records

**Files:**
- Create: `frontend/src/components/ScanVitals.tsx`
- Modify: `frontend/src/pages/VitalsTab.tsx`, `frontend/src/components/BulkVitals.tsx` (accept initial rows and a source file), `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/ScanVitals.test.tsx`

**Interfaces:**
- Flow: **Scan a record** (hidden unless scanning is enabled) -> notice -> `PhotoPicker` -> upload -> `POST /api/scans {kind: "vitals"}` with a visible progress state -> the draft opens in the existing bulk table with low-confidence cells highlighted, warnings listed, default place and date fields applied to empty cells, the photo shown beside the table -> **Save** posts `/api/vitals/bulk` and then attaches the photo as `role: "source"` to each created entry (or once to the first, as decided in the implementation notes). Errors keep the photo and offer a retry or manual entry.

- [ ] **Step 1: Write failing tests**: `scan button hidden when disabled`; `notice then upload then draft rows appear`; `low confidence cells are highlighted and warnings shown`; `editing a cell and deleting a row works before saving`; `save posts bulk and attaches the photo`; `a scan failure keeps the photo and shows retry`; `daily limit message`; `viewer cannot scan`.
- [ ] **Step 2: Run** `npx vitest run src/pages/ScanVitals.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component and the bulk table hooks.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: scan a vitals record into a draft`.

### Task 7: Scan the vaccine schedule

**Files:**
- Create: `backend/app/api/vaccines_import.py` (or extend `vaccines.py`), `frontend/src/components/ScanVaccines.tsx`
- Test: `backend/tests/test_vaccine_import.py`, `frontend/src/pages/ScanVaccines.test.tsx`

**Interfaces:**
- Backend: `POST /api/vaccines/import {entries: [{name, dose_label, due_date, given_on|null, status}], mode: "add_missing"|"replace_pending", file_id|null}` (caregiver): all-or-nothing, validates dates and names, `due_date` required (the screen converts "due at 6 weeks" to a date from the birth date before sending), creates entries with `source: "scan"`, never touches given entries, `replace_pending` soft-deletes pending template or scan entries first; attaches the photo as `role: "card"` when given. Frontend: from the Vaccines screen **Scan the hospital schedule** -> same notice and upload -> draft table (name, dose, due date or age, already given date) with low-confidence highlighting -> confirm mode (add missing, or replace the pending ones) -> import.

- [ ] **Step 1: Write failing tests**: backend `import is all or nothing`, `given entries are never changed`, `replace_pending only removes pending template or scan entries`, `duplicates skipped in add_missing`, `viewer refused`; frontend `scanned schedule shows as an editable draft`, `age-based due dates are converted from the birth date`, `choosing replace asks to confirm`, `nothing is saved until confirmed`.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement** the endpoint and the component.
- [ ] **Step 4: Run** the backend and frontend suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat: scan a vaccine schedule into a draft`.

### Task 8: Medicine photo and label reading

**Files:**
- Create: `frontend/src/components/ScanLabel.tsx`, `backend/alembic/versions/<rev>_medicine_registry_fields.py`
- Modify: `backend/app/models.py`, `backend/app/api/medicines.py`, `frontend/src/components/MedicineForm.tsx`, `frontend/src/pages/Medicines.tsx`
- Test: `backend/tests/test_medicines.py`, `frontend/src/pages/ScanLabel.test.tsx`

**Interfaces:**
- Medicine gains `expiry_date: date|None`, `manufacturer: str`, `label_directions: str` (printed text, display only: the app never turns it into a schedule by itself); included in `MedicineJson` and accepted by create and PATCH. Frontend: in the medicine form **Photo of the medicine** (attached with `role: "medicine_photo"`) and **Read the label** -> notice -> scan -> draft fills the form fields (name, dose amount and unit when the label states a strength or per-dose amount, directions text, expiry, manufacturer) with each filled field marked "from the label" and editable; nothing is saved until the admin presses Save; the app never sets the schedule from the directions. Expired medicines are flagged on the medicines list (info only).

- [ ] **Step 1: Write failing tests**: backend `registry fields round trip`, `expiry in the past is allowed but flagged in JSON`; frontend `label draft fills the form with from-the-label marks`, `unreadable fields stay empty`, `schedule is never set by the scan`, `photo attaches as medicine photo`, `expired medicine flagged`, `only the admin sees Read the label`.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement** the columns, API fields and component.
- [ ] **Step 4: Run** both suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat: medicine photo and label reading`.

### Task 9: Checklist, end-to-end check, real-use stack

**Files:**
- Modify: `docs/MANUAL_TEST_CHECKLIST.md`, `docs/RUNNING_ON_MAC.md`, `.env.example`

- [ ] **Step 1: Add checklist sections**: uploads from an iPhone and an Android phone (camera and gallery, a large photo, a PDF), attachments on all four record kinds, a Viewer's view, the scan notice, a clean photo of a printed table, a messy handwritten page, a blank page, the daily limit, scanning disabled without a key, backup and restore with media.
- [ ] **Step 2: Run** the full suites. Expected: all PASS.
- [ ] **Step 3: Back up the real-use database and media, rebuild, and verify** as in `docs/HANDOFF.md` (the `media` volume exists, an upload and a download round trip works, `alembic current` at the new head, existing data present). Ask the owner whether to set `ANTHROPIC_API_KEY` now.
- [ ] **Step 4: Dev stack smoke test** with a minted session: upload, attach, download from another family (404), a fake-client scan path is covered by tests; one real scan only if the owner supplies a key and a sample photo.
- [ ] **Step 5: Commit** `docs: slice 3b checklist`, then hand off to the owner for real phones.

## Self-Review

- **Spec coverage:** storage and attachments for visits, vaccine card, vitals source, medicine photo (T1, T2, T5); photo import for vitals, vaccine schedule scan, medicine label reading (T3, T6, T7, T8); privacy notice and key handling (T3, T4); backups with media (T2, T9).
- **Type consistency:** `Attachment.owner_kind` and `role` values (T2) match the components (T4, T5); the vitals draft row fields (T3) match the bulk table columns (T6) and the `VitalIn` model from slice 3a; the vaccine draft (T3) matches the import body (T7); the medicine label fields (T3) match the new columns and form fields (T8).
- **Proportion:** each task gives signatures, rules and test names; bodies are left to the implementer.
