"""Curated stock universes for screening US and India markets."""

# US: Major large/mid-cap stocks across sectors (S&P 500 sample)
US_UNIVERSE = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "AVGO", "JPM",
    "LLY", "V", "UNH", "XOM", "MA", "JNJ", "PG", "COST", "HD", "ABBV",
    "WMT", "NFLX", "BAC", "CRM", "ORCL", "KO", "PEP", "ADBE", "TMO", "MRK",
    "CSCO", "AMD", "ACN", "LIN", "DIS", "PFE", "WFC", "ABT", "MCD", "INTC",
    "QCOM", "DHR", "VZ", "IBM", "INTU", "TXN", "PM", "AMGN", "GE", "CAT",
    "ISRG", "NOW", "RTX", "T", "GS", "AXP", "SPGI", "BLK", "BKNG", "NEE",
    "PLD", "HON", "BSX", "AMAT", "MDT", "SCHW", "LOW", "ELV", "C", "SYK",
    "DE", "LMT", "TJX", "BA", "ADP", "VRTX", "GILD", "SBUX", "MMC", "ADI",
    "REGN", "PANW", "MU", "CI", "ETN", "SHW", "MO", "ZTS", "CB", "BMY",
    "EQIX", "CME", "ICE", "DUK", "SO", "SNPS", "KLAC", "PYPL", "UBER", "ABNB",
]

US_INDICES = {
    "^GSPC": "S&P 500",
    "^IXIC": "NASDAQ",
    "^DJI": "Dow Jones",
    "^RUT": "Russell 2000",
}

# India: Nifty 50 + popular large caps (NSE suffix .NS)
IN_UNIVERSE = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "BHARTIARTL.NS", "ICICIBANK.NS",
    "INFY.NS", "SBIN.NS", "LT.NS", "HINDUNILVR.NS", "ITC.NS",
    "BAJFINANCE.NS", "KOTAKBANK.NS", "HCLTECH.NS", "AXISBANK.NS", "MARUTI.NS",
    "ASIANPAINT.NS", "M&M.NS", "SUNPHARMA.NS", "TITAN.NS", "ULTRACEMCO.NS",
    "ADANIENT.NS", "NTPC.NS", "ONGC.NS", "POWERGRID.NS", "WIPRO.NS",
    "TATAMOTORS.NS", "JSWSTEEL.NS", "BAJAJFINSV.NS", "NESTLEIND.NS", "TATASTEEL.NS",
    "COALINDIA.NS", "HDFCLIFE.NS", "GRASIM.NS", "BAJAJ-AUTO.NS", "ADANIPORTS.NS",
    "BPCL.NS", "DRREDDY.NS", "EICHERMOT.NS", "BRITANNIA.NS", "CIPLA.NS",
    "HEROMOTOCO.NS", "DIVISLAB.NS", "INDUSINDBK.NS", "TECHM.NS", "APOLLOHOSP.NS",
    "TATACONSUM.NS", "SBILIFE.NS", "HINDALCO.NS", "SHRIRAMFIN.NS", "LTIM.NS",
    "DMART.NS", "PIDILITIND.NS", "DLF.NS", "ZOMATO.NS", "TRENT.NS",
    "VEDL.NS", "GODREJCP.NS", "SIEMENS.NS", "HAVELLS.NS", "AMBUJACEM.NS",
    "BANKBARODA.NS", "PNB.NS", "CANBK.NS", "IRCTC.NS", "IRFC.NS",
    "BEL.NS", "HAL.NS", "BHEL.NS", "GAIL.NS", "IOC.NS",
    "PFC.NS", "RECLTD.NS", "TVSMOTOR.NS", "MOTHERSON.NS", "BOSCHLTD.NS",
]

IN_INDICES = {
    "^NSEI": "Nifty 50",
    "^BSESN": "Sensex",
    "^NSEBANK": "Bank Nifty",
    "^CNXIT": "Nifty IT",
}


def get_universe(market: str):
    return US_UNIVERSE if market.upper() == "US" else IN_UNIVERSE


def get_indices(market: str):
    return US_INDICES if market.upper() == "US" else IN_INDICES


def currency(market: str):
    return "USD" if market.upper() == "US" else "INR"
