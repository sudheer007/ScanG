#!/usr/bin/env python3
"""Backend API test suite for stock screener app - NEW endpoints focus"""
import requests
import sys
import json
from typing import Dict, Any, List

BASE_URL = "http://localhost:8001"

class TestResult:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
    
    def add_pass(self, test_name: str, details: str = ""):
        self.passed.append(f"✓ {test_name}" + (f": {details}" if details else ""))
    
    def add_fail(self, test_name: str, reason: str):
        self.failed.append(f"✗ {test_name}: {reason}")
    
    def add_warning(self, test_name: str, message: str):
        self.warnings.append(f"⚠ {test_name}: {message}")
    
    def print_summary(self):
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        if self.failed:
            print(f"\n❌ FAILED TESTS ({len(self.failed)}):")
            for f in self.failed:
                print(f"  {f}")
        
        if self.warnings:
            print(f"\n⚠️  WARNINGS ({len(self.warnings)}):")
            for w in self.warnings:
                print(f"  {w}")
        
        if self.passed:
            print(f"\n✅ PASSED TESTS ({len(self.passed)}):")
            for p in self.passed:
                print(f"  {p}")
        
        print(f"\nTotal: {len(self.passed)} passed, {len(self.failed)} failed, {len(self.warnings)} warnings")
        print("="*80)
        
        return len(self.failed) == 0

result = TestResult()

def test_news_market(market: str, limit: int = 30):
    """Test GET /api/news/market endpoint"""
    test_name = f"News Market ({market})"
    try:
        url = f"{BASE_URL}/api/news/market"
        params = {"market": market, "limit": limit}
        resp = requests.get(url, params=params, timeout=30)
        
        if resp.status_code != 200:
            result.add_fail(test_name, f"Expected 200, got {resp.status_code}")
            return
        
        data = resp.json()
        
        # Check required fields
        required_fields = ["market", "currency", "count", "news"]
        missing = [f for f in required_fields if f not in data]
        if missing:
            result.add_fail(test_name, f"Missing fields: {missing}")
            return
        
        # Check market matches
        if data["market"] != market.upper():
            result.add_fail(test_name, f"Market mismatch: expected {market.upper()}, got {data['market']}")
            return
        
        # Check news array
        news_items = data["news"]
        if not isinstance(news_items, list):
            result.add_fail(test_name, "news field is not an array")
            return
        
        # For US market, expect non-empty news
        if market.upper() == "US" and len(news_items) == 0:
            result.add_warning(test_name, "US market returned empty news array (expected non-empty)")
        
        # Validate news item structure
        if news_items:
            item = news_items[0]
            required_item_fields = ["uuid", "title", "publisher", "link", "published_epoch", "type", "thumbnail", "related_tickers"]
            missing_item = [f for f in required_item_fields if f not in item]
            if missing_item:
                result.add_fail(test_name, f"News item missing fields: {missing_item}")
                return
            
            # Check related_tickers is array
            if not isinstance(item["related_tickers"], list):
                result.add_fail(test_name, "related_tickers is not an array")
                return
            
            # Check for duplicates (by link)
            links = [n.get("link") for n in news_items if n.get("link")]
            if len(links) != len(set(links)):
                result.add_fail(test_name, "Duplicate links found (deduplication failed)")
                return
            
            # Check sorting by published_epoch (descending)
            epochs = [n.get("published_epoch") for n in news_items if n.get("published_epoch")]
            if epochs != sorted(epochs, reverse=True):
                result.add_fail(test_name, "News items not sorted by published_epoch desc")
                return
        
        result.add_pass(test_name, f"Returned {len(news_items)} news items, properly deduped and sorted")
        
    except requests.exceptions.Timeout:
        result.add_fail(test_name, "Request timeout (>30s)")
    except Exception as e:
        result.add_fail(test_name, f"Exception: {str(e)}")

def test_news_stock(symbol: str, limit: int = 20):
    """Test GET /api/news/stock/{symbol} endpoint"""
    test_name = f"News Stock ({symbol})"
    try:
        url = f"{BASE_URL}/api/news/stock/{symbol}"
        params = {"limit": limit}
        resp = requests.get(url, params=params, timeout=30)
        
        if resp.status_code != 200:
            result.add_fail(test_name, f"Expected 200, got {resp.status_code}")
            return
        
        data = resp.json()
        
        # Check required fields
        required_fields = ["symbol", "count", "news"]
        missing = [f for f in required_fields if f not in data]
        if missing:
            result.add_fail(test_name, f"Missing fields: {missing}")
            return
        
        # Check symbol matches
        if data["symbol"] != symbol:
            result.add_fail(test_name, f"Symbol mismatch: expected {symbol}, got {data['symbol']}")
            return
        
        # Check news array
        news_items = data["news"]
        if not isinstance(news_items, list):
            result.add_fail(test_name, "news field is not an array")
            return
        
        # For US tickers, expect non-empty news
        if not symbol.endswith(".NS") and len(news_items) == 0:
            result.add_warning(test_name, f"US ticker {symbol} returned empty news (expected non-empty)")
        
        # Validate news item structure if present
        if news_items:
            item = news_items[0]
            required_item_fields = ["uuid", "title", "publisher", "link", "published_epoch", "type", "thumbnail", "related_tickers"]
            missing_item = [f for f in required_item_fields if f not in item]
            if missing_item:
                result.add_fail(test_name, f"News item missing fields: {missing_item}")
                return
        
        result.add_pass(test_name, f"Returned {len(news_items)} news items")
        
    except requests.exceptions.Timeout:
        result.add_fail(test_name, "Request timeout (>30s)")
    except Exception as e:
        result.add_fail(test_name, f"Exception: {str(e)}")

def test_stock_events(symbol: str):
    """Test GET /api/stocks/{symbol}/events endpoint"""
    test_name = f"Stock Events ({symbol})"
    try:
        url = f"{BASE_URL}/api/stocks/{symbol}/events"
        resp = requests.get(url, timeout=30)
        
        if resp.status_code != 200:
            result.add_fail(test_name, f"Expected 200, got {resp.status_code}")
            return
        
        data = resp.json()
        
        # Check required top-level fields
        required_fields = ["symbol", "calendar", "analyst_actions", "earnings_history", "recommendation_key", "target_mean_price"]
        missing = [f for f in required_fields if f not in data]
        if missing:
            result.add_fail(test_name, f"Missing fields: {missing}")
            return
        
        # Check calendar structure
        calendar = data["calendar"]
        if not isinstance(calendar, dict):
            result.add_fail(test_name, "calendar is not an object")
            return
        
        required_calendar_keys = [
            "next_earnings_epoch", "ex_dividend_epoch", "dividend_date_epoch",
            "eps_estimate_avg", "eps_estimate_low", "eps_estimate_high",
            "next_quarter_eps_est", "next_year_eps_est"
        ]
        missing_cal = [k for k in required_calendar_keys if k not in calendar]
        if missing_cal:
            result.add_fail(test_name, f"Calendar missing keys: {missing_cal}")
            return
        
        # Check analyst_actions array
        analyst_actions = data["analyst_actions"]
        if not isinstance(analyst_actions, list):
            result.add_fail(test_name, "analyst_actions is not an array")
            return
        
        if analyst_actions:
            action = analyst_actions[0]
            required_action_fields = ["date_epoch", "firm", "from_grade", "to_grade", "action", "tone"]
            missing_action = [f for f in required_action_fields if f not in action]
            if missing_action:
                result.add_fail(test_name, f"Analyst action missing fields: {missing_action}")
                return
            
            # Check tone is valid
            if action["tone"] not in ["pos", "neg", "neutral"]:
                result.add_fail(test_name, f"Invalid tone value: {action['tone']} (expected pos/neg/neutral)")
                return
        
        # Check earnings_history array
        earnings_history = data["earnings_history"]
        if not isinstance(earnings_history, list):
            result.add_fail(test_name, "earnings_history is not an array")
            return
        
        if earnings_history:
            earning = earnings_history[0]
            required_earning_fields = ["quarter_epoch", "eps_actual", "eps_estimate", "eps_difference", "surprise_pct"]
            missing_earning = [f for f in required_earning_fields if f not in earning]
            if missing_earning:
                result.add_fail(test_name, f"Earnings history item missing fields: {missing_earning}")
                return
            
            # Check surprise_pct is a percentage (not a tiny fraction)
            surprise = earning.get("surprise_pct")
            if surprise is not None:
                # Should be in range like -50 to 50, not 0.03
                if abs(surprise) < 2 and surprise != 0:
                    result.add_fail(test_name, f"surprise_pct looks like a fraction ({surprise}), not a percentage")
                    return
        
        result.add_pass(test_name, f"{len(analyst_actions)} analyst actions, {len(earnings_history)} earnings records")
        
    except requests.exceptions.Timeout:
        result.add_fail(test_name, "Request timeout (>30s)")
    except Exception as e:
        result.add_fail(test_name, f"Exception: {str(e)}")

def test_regression_endpoint(endpoint: str, test_name: str):
    """Test regression endpoints - just check they return 200"""
    try:
        url = f"{BASE_URL}{endpoint}"
        resp = requests.get(url, timeout=30)
        
        if resp.status_code != 200:
            result.add_fail(test_name, f"Expected 200, got {resp.status_code}")
            return
        
        # Try to parse JSON
        try:
            data = resp.json()
            result.add_pass(test_name, "Returns 200 with valid JSON")
        except:
            result.add_fail(test_name, "Response is not valid JSON")
        
    except requests.exceptions.Timeout:
        result.add_fail(test_name, "Request timeout (>30s)")
    except Exception as e:
        result.add_fail(test_name, f"Exception: {str(e)}")

def main():
    print("="*80)
    print("BACKEND API TESTING - NEW ENDPOINTS")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print()
    
    # Test NEW endpoints
    print("Testing NEW endpoints...")
    print("-" * 80)
    
    # 1. Market news
    print("\n1. Testing market news endpoints...")
    test_news_market("US", 30)
    test_news_market("IN", 30)
    
    # 2. Stock news
    print("\n2. Testing stock news endpoints...")
    test_news_stock("AAPL", 20)
    test_news_stock("TSLA", 20)
    test_news_stock("MSFT", 20)
    test_news_stock("RELIANCE.NS", 20)
    
    # 3. Stock events
    print("\n3. Testing stock events endpoints...")
    test_stock_events("AAPL")
    test_stock_events("MSFT")
    test_stock_events("TSLA")
    
    # Test REGRESSION endpoints
    print("\n" + "-" * 80)
    print("Testing REGRESSION endpoints (sanity check)...")
    print("-" * 80)
    
    test_regression_endpoint("/api/markets/overview?market=US", "Markets Overview")
    test_regression_endpoint("/api/discover/sector-rotation?market=US", "Sector Rotation")
    test_regression_endpoint("/api/discover/earnings-calendar?market=US", "Earnings Calendar")
    test_regression_endpoint("/api/discover/dividend-calendar?market=US", "Dividend Calendar")
    test_regression_endpoint("/api/stocks/AAPL", "Stock Detail (AAPL)")
    
    # Print summary
    success = result.print_summary()
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
