"""Tests for the server-side visual workspace payload."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest

PACKAGE = "paperless_workspace_test_package"
ROOT = Path(__file__).parents[1] / "custom_components" / "paperless_workflows"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package
aiohttp = types.ModuleType("aiohttp")
aiohttp.ClientResponseError = type("ClientResponseError", (Exception,), {})
aiohttp.ClientSession = object
sys.modules.setdefault("aiohttp", aiohttp)
for module_name in ("amounts", "normalization", "views", "api"):
    spec = importlib.util.spec_from_file_location(
        f"{PACKAGE}.{module_name}", ROOT / f"{module_name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[f"{PACKAGE}.{module_name}"] = module
    spec.loader.exec_module(module)

PaperlessWorkflowClient = sys.modules[f"{PACKAGE}.api"].PaperlessWorkflowClient

METADATA = {
    "tags": [{"id": 7, "name": "Bezahlen", "color": "#d6675b"}],
    "correspondents": [{"id": 3, "name": "Labor"}],
    "document_types": [], "storage_paths": [], "users": [],
    "custom_fields": [
        {"id": 2, "name": "Betrag", "data_type": "monetary"},
        {"id": 9, "name": "Fälligkeitsdatum", "data_type": "date"},
    ],
}

DOCUMENTS = [
    {
        "id": 10, "title": "R1", "correspondent": 3, "tags": [7],
        "created": "2026-10-01",
        "custom_fields": [
            {"field": 2, "value": "EUR10.50"},
            {"field": 9, "value": "2026-10-31"},
        ],
    },
    {
        "id": 11, "title": "R2", "correspondent": 3, "tags": [7],
        "created": "2026-10-02",
        "custom_fields": [{"field": 2, "value": 20}],
    },
]


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_only_selected_columns_and_complete_summary(self):
        client = PaperlessWorkflowClient.__new__(PaperlessWorkflowClient)
        client.base_url = "https://paperless.example"

        async def fake_get_all(endpoint, params=None):
            self.assertEqual(endpoint, "api/documents/")
            self.assertEqual(params["tags__id__all"], "7")
            return DOCUMENTS

        client._get_all = fake_get_all
        result = await client.fetch_tag_workspace(
            tag_id=7,
            metadata=METADATA,
            columns=["standard:title", "standard:correspondent", "custom:9"],
            sum_field_id=2,
            default_currency="EUR",
            ordering="created",
            max_documents=1,
        )

        self.assertEqual(result["count"], 2)
        self.assertEqual(result["documents_shown"], 1)
        self.assertTrue(result["documents_truncated"])
        self.assertEqual(result["documents"][0]["title"], "R1")
        self.assertEqual(result["documents"][0]["correspondent"], "Labor")
        self.assertEqual(
            result["documents"][0]["custom_fields"],
            {"Fälligkeitsdatum": "2026-10-31"},
        )
        self.assertEqual(result["aggregate"]["totals"], {"EUR": 30.5})

    async def test_summary_mode_omits_documents(self):
        client = PaperlessWorkflowClient.__new__(PaperlessWorkflowClient)
        client.base_url = "https://paperless.example"

        async def fake_get_all(_endpoint, _params=None):
            return DOCUMENTS

        client._get_all = fake_get_all
        result = await client.fetch_tag_workspace(
            tag_id=7, metadata=METADATA, columns=[], sum_field_id=None,
            default_currency="EUR", max_documents=0,
        )
        self.assertEqual(result["count"], 2)
        self.assertEqual(result["documents"], [])


if __name__ == "__main__":
    unittest.main()
