# ScanG backend-v2

## Setup

```bash
cd backend-v2
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

## Portfolio import (PDF / images)

Watchlist portfolio upload supports CSV, TSV, TXT, PDF, and images (JPEG/PNG/WebP). PDF text is extracted with `pdfplumber`; scanned PDFs and images use **local Tesseract OCR** (no cloud AI).

Install Tesseract on the server and ensure it is on `PATH`:

- **Windows:** `choco install tesseract` or [UB Mannheim installer](https://github.com/UB-Mannheim/tesseract/wiki). If it is not on `PATH`, set `TESSERACT_CMD` in `.env` (e.g. `C:\Program Files\Tesseract-OCR\tesseract.exe`). The backend also auto-detects that default install path.
- **Linux:** `sudo apt install tesseract-ocr`
- **macOS:** `brew install tesseract`

If Tesseract is missing, image and scanned-PDF imports return `503 OCR is not available on the server`.

## Environment

Copy [`.env.example`](.env.example) to `.env` and set `MONGO_URL`, `DB_NAME`, and Firebase credentials.

On Render / Docker, prefer `FIREBASE_CREDENTIALS_JSON` (full service-account JSON as one line) instead of a file path. See the root [`DEPLOYMENT.md`](../DEPLOYMENT.md) and [`Dockerfile`](Dockerfile).
