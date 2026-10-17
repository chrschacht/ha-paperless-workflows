"""Tests for Paperless monetary parsing."""

from decimal import Decimal
import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).parents[1] / "custom_components" / "paperless_workflows" / "amounts.py"
SPEC = importlib.util.spec_from_file_location("paperless_amounts", MODULE_PATH)
amounts = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(amounts)

NORMALIZATION_PATH = Path(__file__).parents[1] / "custom_components" / "paperless_workflows" / "normalization.py"
NORMALIZATION_SPEC = importlib.util.spec_from_file_location("paperless_normalization", NORMALIZATION_PATH)
normalization = importlib.util.module_from_spec(NORMALIZATION_SPEC)
assert NORMALIZATION_SPEC and NORMALIZATION_SPEC.loader
NORMALIZATION_SPEC.loader.exec_module(normalization)


class AmountTests(unittest.TestCase):
    def test_normalizes_umlaut_and_ascii_spellings(self):
        self.assertEqual(
            normalization.normalize_lookup_name("ocrprüfen"),
            normalization.normalize_lookup_name("ocrpruefen"),
        )
        self.assertEqual(
            normalization.normalize_lookup_name("KI-prüfen"),
            normalization.normalize_lookup_name("ki-pruefen"),
        )

    def test_parses_currency_and_plain_values(self):
        self.assertEqual(amounts.parse_monetary("EUR12.30", "EUR"), ("EUR", Decimal("12.30")))
        self.assertEqual(amounts.parse_monetary("10.9", "EUR"), ("EUR", Decimal("10.9")))
        self.assertEqual(amounts.parse_monetary("CHF 1,50", "EUR"), ("CHF", Decimal("1.50")))

    def test_sums_live_shape(self):
        documents = [
            {"custom_fields": [{"field": 2, "value": "EUR100.00"}]},
            {"custom_fields": [{"field": 2, "value": "10.5"}]},
            {"custom_fields": [{"field": 2, "value": None}]},
        ]
        totals, invalid = amounts.sum_monetary(documents, 2, "EUR")
        self.assertEqual(totals, {"EUR": Decimal("110.50")})
        self.assertEqual(invalid, 0)

    def test_mixed_paperless_monetary_representation(self):
        values = ["100.0", "10.9", "172.55", "EUR1306.68", "1451.8", "EUR1437.52"]
        documents = [
            {"custom_fields": [{"field": 2, "value": value}]}
            for value in values
        ]
        totals, invalid = amounts.sum_monetary(documents, 2, "EUR")
        self.assertEqual(totals, {"EUR": Decimal("4479.45")})
        self.assertEqual(invalid, 0)


if __name__ == "__main__":
    unittest.main()
