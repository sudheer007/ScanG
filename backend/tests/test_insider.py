"""Unit tests for Track B insider tracking (backend/insider_service.py).

Uses a real Form 4 XML filing (Apple Inc., accession 0001140361-26-025622)
as a fixture, fetched once and frozen here — no network needed to run.
Run with: cd backend && pytest tests/test_insider.py -v
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import insider_service as ins  # noqa: E402

REAL_FORM4_XML = """<?xml version="1.0"?>
<ownershipDocument>
    <schemaVersion>X0609</schemaVersion>
    <documentType>4</documentType>
    <periodOfReport>2026-06-15</periodOfReport>
    <issuer>
        <issuerCik>0000320193</issuerCik>
        <issuerName>Apple Inc.</issuerName>
        <issuerTradingSymbol>AAPL</issuerTradingSymbol>
    </issuer>
    <reportingOwner>
        <reportingOwnerId>
            <rptOwnerCik>0001780525</rptOwnerCik>
            <rptOwnerName>Newstead Jennifer</rptOwnerName>
        </reportingOwnerId>
        <reportingOwnerRelationship>
            <isOfficer>true</isOfficer>
            <officerTitle>SVP, GC and Secretary</officerTitle>
        </reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-06-15</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>M</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>30104</value></transactionShares>
                <transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>57784</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value><footnoteId id="F2"/></securityTitle>
            <transactionDate><value>2026-06-15</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>F</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>16238</value></transactionShares>
                <transactionPricePerShare><value>296.42</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>41546</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
        </nonDerivativeTransaction>
    </nonDerivativeTable>
    <derivativeTable>
        <derivativeTransaction>
            <securityTitle><value>Restricted Stock Unit</value></securityTitle>
        </derivativeTransaction>
    </derivativeTable>
</ownershipDocument>
"""


class TestParseForm4:
    def test_extracts_owner_and_role(self):
        root = ET.fromstring(REAL_FORM4_XML)
        txns = ins._parse_form4(root, "2026-06-17", "0001140361-26-025622")
        assert len(txns) == 2
        assert txns[0]["owner_name"] == "Newstead Jennifer"
        assert txns[0]["owner_role"] == "SVP, GC and Secretary"

    def test_option_exercise_has_no_price(self):
        root = ET.fromstring(REAL_FORM4_XML)
        txns = ins._parse_form4(root, "2026-06-17", "acc1")
        exercise = next(t for t in txns if t["transaction_code"] == "M")
        assert exercise["price"] is None
        assert exercise["value"] is None
        assert exercise["shares"] == 30104
        assert exercise["sentiment"] == "neutral"

    def test_tax_withholding_has_price_and_value(self):
        root = ET.fromstring(REAL_FORM4_XML)
        txns = ins._parse_form4(root, "2026-06-17", "acc1")
        withholding = next(t for t in txns if t["transaction_code"] == "F")
        assert withholding["price"] == 296.42
        assert withholding["shares"] == 16238
        assert withholding["value"] == round(16238 * 296.42, 2)
        assert withholding["transaction_label"] == "Tax Withholding"
        assert withholding["sentiment"] == "neutral"

    def test_derivative_table_ignored(self):
        root = ET.fromstring(REAL_FORM4_XML)
        txns = ins._parse_form4(root, "2026-06-17", "acc1")
        # only the 2 nonDerivativeTransaction entries, not the RSU derivative one
        assert len(txns) == 2

    def test_no_non_derivative_table_returns_empty(self):
        root = ET.fromstring("<ownershipDocument><reportingOwner/></ownershipDocument>")
        assert ins._parse_form4(root, "2026-01-01", "acc") == []


class TestTransactionCodes:
    def test_purchase_and_sale_have_correct_sentiment(self):
        assert ins.TRANSACTION_CODES["P"][1] == "buy"
        assert ins.TRANSACTION_CODES["S"][1] == "sell"


class TestSummary:
    def test_empty_transactions_yields_neutral(self):
        summary = ins._compute_summary([])
        assert summary["net_sentiment"] == "neutral"
        assert summary["buy_count"] == 0
        assert summary["sell_count"] == 0

    def test_buying_outweighs_selling_is_bullish(self):
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        txns = [
            {"transaction_date": today, "sentiment": "buy", "value": 1_000_000},
            {"transaction_date": today, "sentiment": "sell", "value": 10_000},
        ]
        summary = ins._compute_summary(txns)
        assert summary["net_sentiment"] == "bullish"
        assert summary["buy_count"] == 1
        assert summary["sell_count"] == 1

    def test_old_transactions_outside_window_excluded(self):
        txns = [
            {"transaction_date": "2020-01-01", "sentiment": "buy", "value": 1_000_000},
        ]
        summary = ins._compute_summary(txns)
        assert summary["buy_count"] == 0
        assert summary["net_sentiment"] == "neutral"


class TestTickerCikMap:
    def test_get_cik_uppercases_symbol(self, monkeypatch):
        monkeypatch.setattr(ins, "_get_ticker_cik_map", lambda: {"AAPL": "0000320193"})
        assert ins._get_cik("aapl") == "0000320193"
        assert ins._get_cik("MISSING") is None
