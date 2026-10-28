"""Constants for Paperless Workflows."""

from __future__ import annotations

from copy import deepcopy
from datetime import timedelta

DOMAIN = "paperless_workflows"

CONF_API_KEY = "api_key"
CONF_VERIFY_SSL = "verify_ssl"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_DEFAULT_CURRENCY = "default_currency"
CONF_VIEWS = "views"

DEFAULT_SCAN_INTERVAL = 300
MIN_SCAN_INTERVAL = 30
DEFAULT_CURRENCY = "EUR"
MAX_DOCUMENTS_IN_ATTRIBUTES = 50
MAX_ATTRIBUTE_BYTES = 14_000

PLATFORMS = ["sensor", "binary_sensor"]
DEFAULT_UPDATE_INTERVAL = timedelta(seconds=DEFAULT_SCAN_INTERVAL)

DOCUMENT_FIELDS = {
    "title": "Titel", "correspondent": "Korrespondent", "document_type": "Dokumenttyp",
    "storage_path": "Speicherpfad", "tags": "Tags", "custom_fields": "Custom Fields",
    "created": "Erstellt", "added": "Hinzugefügt", "modified": "Geändert",
    "archive_serial_number": "Archivnummer", "original_file_name": "Originaldatei",
    "mime_type": "MIME-Typ", "page_count": "Seiten", "owner": "Eigentümer",
}

GROUP_DIMENSIONS = {
    "none": "Keine Gruppierung", "tags": "Tags", "correspondent": "Korrespondent",
    "document_type": "Dokumenttyp", "storage_path": "Speicherpfad", "owner": "Eigentümer",
    "mime_type": "MIME-Typ", "created_month": "Erstellmonat", "created_year": "Erstelljahr",
    "added_month": "Importmonat", "added_year": "Importjahr",
}

DEFAULT_VIEWS = [
    {
        "id": "payments", "name": "Zu bezahlen", "icon": "mdi:cash-clock", "enabled": True,
        "filters": {"tags_all": ["Bezahlen"]}, "display_documents": True,
        "document_fields": ["title", "correspondent", "document_type", "tags", "custom_fields", "created"],
        "document_custom_fields": ["Betrag", "Fälligkeitsdatum"],
        "max_documents": 25, "count": True, "attention": True, "attention_threshold": 1,
        "aggregate_fields": ["Betrag"], "group_by": "none", "secondary_group_by": "none",
        "advanced_filters": {},
    },
    {
        "id": "ai-review", "name": "KI prüfen", "icon": "mdi:robot-confused-outline", "enabled": True,
        "filters": {"tags_all": ["KI-prüfen"]}, "display_documents": True,
        "document_fields": ["title", "correspondent", "document_type", "tags"],
        "max_documents": 25, "count": True, "attention": True, "attention_threshold": 1,
        "aggregate_fields": [], "group_by": "none", "secondary_group_by": "none", "advanced_filters": {},
    },
    {
        "id": "ocr-review", "name": "OCR prüfen", "icon": "mdi:text-box-search-outline", "enabled": True,
        "filters": {"tags_all": ["ocrpruefen"]}, "display_documents": True,
        "document_fields": ["title", "correspondent", "document_type", "tags"],
        "max_documents": 25, "count": True, "attention": True, "attention_threshold": 1,
        "aggregate_fields": [], "group_by": "none", "secondary_group_by": "none", "advanced_filters": {},
    },
]


def default_views() -> list[dict]:
    """Return an isolated default configuration."""
    return deepcopy(DEFAULT_VIEWS)
