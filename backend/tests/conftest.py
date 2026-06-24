import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load frontend .env to get EXPO_PUBLIC_BACKEND_URL (the public endpoint to hit)
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL is not set")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
