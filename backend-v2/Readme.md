# ScanG backend-v2

## Setup

```bash
cd backend-v2
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
python scripts/train_nifty_pulse_model.py
curl http://127.0.0.1:8000/api/predict/nifty?horizon=60


- LightGBM classifier + vol-normalized features + meta-label abstention + GARCH deadband, 

```

## Portfolio import (PDF / images)

Watchlist portfolio upload supports CSV, TSV, TXT, PDF, and images (JPEG/PNG/WebP). PDF text is extracted with `pdfplumber`; scanned PDFs and images use **local Tesseract OCR** (no cloud AI).

Install Tesseract on the server and ensure it is on `PATH`:

- **Windows:** `choco install tesseract` or [UB Mannheim installer](https://github.com/UB-Mannheim/tesseract/wiki). If it is not on `PATH`, set `TESSERACT_CMD` in `.env` (e.g. `C:\Program Files\Tesseract-OCR\tesseract.exe`). The backend also auto-detects that default install path.
- **Linux:** `sudo apt install tesseract-ocr`
- **macOS:** `brew install tesseract`

If Tesseract is missing, image and scanned-PDF imports return `503 OCR is not available on the server`.

## Environment

Copy `[.env.example](.env.example)` to `.env` and set `MONGO_URL`, `DB_NAME`, and Firebase credentials.

## Nifty pulse ML model

During market hours the backend logs per-minute features to Mongo (`nifty_prediction_logs`). After you have enough resolved rows, train the primary + meta-label models:

```bash
cd backend-v2
pip install -r requirements.txt
python scripts/train_nifty_pulse_model.py
```

The artifact is written to `models/nifty_pulse.joblib` (override with `NIFTY_MODEL_PATH`). Restart the API so `start_poller()` loads it. Until then, predictions use the rule-based scorer with vol-scaled deadbands for hit/miss labels.