# Radar — Stock Screener (US + India)

## Product
A premium, dark-themed mobile stock screener inspired by investing.com that surfaces "super stocks" via a radar metaphor across US and Indian markets. **No buy/sell** — purely discovery and analysis.

## Core Features
1. **Markets** — Live indices (S&P 500, NASDAQ, DOW, Russell 2000 / Nifty 50, Sensex, Bank Nifty, Nifty IT), Top Gainers and Top Losers with sparklines.
2. **Radar** — 8 pre-built smart screens: Momentum Breakouts, Value Picks, Quality Compounders (High ROCE Low Debt), Oversold Quality, Multibagger Radar, 52-Week Breakouts, Dividend Aristocrats, Golden Cross.
3. **Screener** — Custom filter builder with 13 metrics (Mkt Cap, P/E, P/B, ROE, D/E, Div Yield, EPS Growth, Revenue Growth, Profit Margin, RSI, Volume Surge, From 52w High, % change), 6 sort options, active filter chips.
4. **Watchlist** — Local persistence, live batch quotes refresh, tap to view stock detail.
5. **Stock Detail** — Live price, multi-timeframe interactive chart (1D/1W/1M/3M/6M/1Y/5Y), Key Metrics grid (Market Cap, P/E, P/B, EPS, ROE, D/E, Div Yield, Beta, Profit Margin), Growth (EPS Δ, Revenue Δ, Forward P/E), Technicals (RSI badge with sentiment, 50/200 DMA, MACD, Volume Surge, 52w High/Low/From High%).
6. **Search** — Cross-market search by ticker or company name (debounced).

## Data Source
**Yahoo Finance public API** (v8 chart + v10 quoteSummary), accessed directly via curl_cffi browser impersonation. Caches: bundles 2 min, history 5 min, full universe 3 min. Pre-warm on backend startup.

## Universes
- **US**: 100 large/mid-cap S&P 500 names
- **India**: 75 NSE large-caps (Nifty 50 + Next 50 + popular names)

## Tech Stack
- **Frontend**: Expo SDK 54, expo-router (file-based), TypeScript, react-native-svg (sparkline + chart), expo-linear-gradient, expo-blur (iOS tab bar), AsyncStorage via shared storage util.
- **Backend**: FastAPI + uvicorn, motor (MongoDB for optional saved watchlists/screens), pandas/numpy (technicals), curl_cffi (Yahoo API), cachetools.

## Smart Business Enhancement
Pre-built Radar strategies act as a habit-forming entry point — every time the user opens the app they see fresh "super stock" scans, increasing engagement and time-in-app.
