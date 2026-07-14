"""HTTP client for Investing.com with throttling and retries."""

from __future__ import annotations

import logging
import random
import time
from typing import Any, Dict, Optional

from curl_cffi import requests as cffi_req

log = logging.getLogger(__name__)

BASE_URL = "https://www.investing.com"
SEARCH_API = "https://api.investing.com/api/search/v2/search"


class InvestingClient:
  def __init__(
      self,
      min_delay_s: float = 0.8,
      max_delay_s: float = 1.6,
      timeout_s: int = 30,
      max_retries: int = 3,
  ):
      self.min_delay_s = min_delay_s
      self.max_delay_s = max_delay_s
      self.timeout_s = timeout_s
      self.max_retries = max_retries
      self._session = cffi_req.Session(impersonate="chrome")
      self._last_request_at = 0.0
      self._bootstrap()

  def _bootstrap(self) -> None:
      try:
          self._session.get(BASE_URL, headers=self._headers(), timeout=self.timeout_s)
      except Exception as exc:  # noqa: BLE001
          log.debug("bootstrap failed: %s", exc)

  def _throttle(self) -> None:
      elapsed = time.time() - self._last_request_at
      wait = random.uniform(self.min_delay_s, self.max_delay_s)
      if elapsed < wait:
          time.sleep(wait - elapsed)

  def _headers(self, referer: Optional[str] = None, *, api: bool = False) -> Dict[str, str]:
      headers = {
          "Referer": referer or f"{BASE_URL}/",
          "Accept-Language": "en-US,en;q=0.9",
      }
      if api:
          headers["domain-id"] = "www"
      return headers

  def get(self, url: str, *, params: Optional[Dict[str, Any]] = None, referer: Optional[str] = None) -> cffi_req.Response:
      last_err: Optional[Exception] = None
      for attempt in range(self.max_retries):
          try:
              self._throttle()
              resp = self._session.get(
                  url,
                  params=params,
                  headers=self._headers(referer=referer, api=url.startswith("https://api.investing.com/")),
                  timeout=self.timeout_s,
              )
              self._last_request_at = time.time()
              if resp.status_code in (403, 429, 500, 502, 503, 504) and attempt < self.max_retries - 1:
                  if resp.status_code == 403:
                      self._bootstrap()
                  time.sleep((2 ** attempt) + random.uniform(0.2, 0.8))
                  continue
              return resp
          except Exception as exc:  # noqa: BLE001
              last_err = exc
              if attempt >= self.max_retries - 1:
                  raise
              time.sleep((2 ** attempt) + random.uniform(0.2, 0.8))
      raise RuntimeError(f"request failed: {url}") from last_err

  def get_text(self, url: str, *, params: Optional[Dict[str, Any]] = None, referer: Optional[str] = None) -> str:
      resp = self.get(url, params=params, referer=referer)
      resp.raise_for_status()
      return resp.text

  def search_quotes(self, query: str, limit: int = 30) -> list[dict]:
      resp = self.get(
          SEARCH_API,
          params={"q": query, "tab": "quotes", "lang": "en"},
          referer=f"{BASE_URL}/search/",
      )
      resp.raise_for_status()
      quotes = resp.json().get("quotes") or []
      return quotes[:limit]

  def equity_page(self, slug: str, page_suffix: str) -> str:
      url = f"{BASE_URL}/equities/{slug}-{page_suffix}"
      return self.get_text(url, referer=BASE_URL)

  def equity_overview(self, slug: str) -> str:
      url = f"{BASE_URL}/equities/{slug}"
      return self.get_text(url, referer=BASE_URL)

  def hub_page(self, url: str) -> str:
      return self.get_text(url, referer=BASE_URL)
