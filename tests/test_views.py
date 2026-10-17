"""Tests for configurable Paperless views."""

from decimal import Decimal
import importlib.util
from pathlib import Path
import sys
import types
import unittest

PACKAGE = "paperless_test_package"
ROOT = Path(__file__).parents[1] / "custom_components" / "paperless_workflows"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package
for module_name in ("amounts", "normalization", "views"):
    spec = importlib.util.spec_from_file_location(f"{PACKAGE}.{module_name}", ROOT / f"{module_name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[f"{PACKAGE}.{module_name}"] = module
    spec.loader.exec_module(module)

views = sys.modules[f"{PACKAGE}.views"]
aggregate_field = views.aggregate_field
bounded_documents = views.bounded_documents
build_query = views.build_query
group_documents = views.group_documents
metadata_maps = views.metadata_maps
render_document = views.render_document


METADATA = {
    "tags": [{"id": 7, "name": "Bezahlen"}, {"id": 26, "name": "KI-prüfen"}],
    "correspondents": [{"id": 3, "name": "Labor"}],
    "document_types": [{"id": 4, "name": "Rechnung"}],
    "storage_paths": [{"id": 5, "name": "Praxis"}],
    "users": [{"id": 1, "username": "christian"}],
    "custom_fields": [{"id": 2, "name": "Betrag", "data_type": "monetary"}, {"id": 8, "name": "Mahnstufe", "data_type": "integer"}],
}

DOCUMENTS = [
    {"id": 10, "title": "R1", "tags": [7], "correspondent": 3, "document_type": 4, "storage_path": 5, "owner": 1, "created": "2026-10-01", "custom_fields": [{"field": 2, "value": "EUR10.50"}, {"field": 8, "value": 1}]},
    {"id": 11, "title": "R2", "tags": [7, 26], "correspondent": 3, "document_type": 4, "storage_path": 5, "owner": 1, "created": "2026-10-02", "custom_fields": [{"field": 2, "value": 20}, {"field": 8, "value": 2}]},
]


class ViewTests(unittest.TestCase):
    def test_builds_friendly_and_expert_query(self):
        query, missing = build_query({"filters": {"tags_all": ["Bezahlen"], "correspondents": ["Labor"]}, "advanced_filters": {"has_custom_fields": True, "page_size": 999}}, METADATA)
        self.assertEqual(query["tags__id__all"], "7")
        self.assertEqual(query["correspondent__id__in"], "3")
        self.assertTrue(query["has_custom_fields"])
        self.assertNotIn("page_size", query)
        self.assertEqual(missing, [])

    def test_renders_only_selected_details_and_custom_fields(self):
        rendered = render_document(DOCUMENTS[0], ["title", "correspondent", "custom_fields"], metadata_maps(METADATA), "https://paperless.example", ["Betrag"])
        self.assertEqual(rendered["correspondent"], "Labor")
        self.assertEqual(rendered["custom_fields"], {"Betrag": "EUR10.50"})
        self.assertNotIn("tags", rendered)

    def test_aggregates_and_groups_counts_and_sums(self):
        totals, invalid = aggregate_field(DOCUMENTS, METADATA["custom_fields"][0], "EUR")
        self.assertEqual(totals, {"EUR": Decimal("30.50")})
        self.assertEqual(invalid, 0)
        groups = group_documents(DOCUMENTS, "correspondent", "created_month", metadata_maps(METADATA), METADATA["custom_fields"], "EUR")
        self.assertEqual(groups["Labor"]["2026-10"]["count"], 2)
        self.assertEqual(groups["Labor"]["2026-10"]["sums"]["Betrag"]["EUR"], 30.5)
        self.assertEqual(groups["Labor"]["2026-10"]["sums"]["Mahnstufe"], 3.0)

    def test_bounds_document_attributes_by_bytes(self):
        shown, truncated = bounded_documents([{"title": "x" * 100}, {"title": "y" * 100}], 50, 150)
        self.assertEqual(len(shown), 1)
        self.assertTrue(truncated)


if __name__ == "__main__":
    unittest.main()
