# Paperless Workflows for Home Assistant

A flexible companion for Home Assistant's built-in Paperless-ngx integration.
It keeps the core `paperless_ngx` domain untouched and adds configurable
document views, workflow indicators, aggregations, and grouping.

## The view builder

One Paperless connection can contain any number of views. A guided options
flow configures each view in small steps:

1. Name, icon, and enabled state
2. Tags: match any, match all, or exclude
3. Correspondents, document types, storage paths, and owners
4. Exclusions for all those metadata types
5. Full-text search, date range, MIME type, and optional expert filters
6. Individual-document display and the exact details to expose
7. Counts, attention thresholds, sums, and one- or two-level grouping

Views may group documents by tag, correspondent, document type, storage path,
owner, MIME type, import/creation month or year, or any custom field. Numeric
and monetary custom fields can be summed globally and inside every group.

For individual documents, the user selects details such as title,
correspondent, document type, tags, storage path, dates, filename, page count,
owner, and specific custom fields. Attributes are bounded by both a configured
document limit and a serialized-size guard.

The expert filter accepts a JSON object containing native parameters from the
Paperless `/api/documents/` endpoint. Pagination and response-shape parameters
are deliberately ignored. This provides an escape hatch for new Paperless
filters without making the normal wizard complicated.

## Entities

Depending on the choices made for a view, the integration creates:

- A summary sensor with count, optional document details, and group results
- One aggregate sensor per selected numeric or monetary custom field
- An optional problem binary sensor using a configurable count threshold
- One global configuration problem sensor for missing tags or custom fields

The initial setup contains useful views for `Bezahlen`, `KI-prüfen`, and
`ocrpruefen`. The payment view sums the `Betrag` monetary field. All defaults
can be edited or deleted in the UI.

Every summary sensor also exposes the current Paperless tag colors in
`tag_colors`. `accent_color` and `accent_tag` identify the first required
(`tags_all`) or optional (`tags_any`) workflow tag. These attributes are
refreshed with the normal polling cycle, so dashboards can follow color
changes made in Paperless without hard-coded color values.

## Installation

Copy `custom_components/paperless_workflows` to Home Assistant's
`/config/custom_components/` directory, restart Home Assistant, and add
**Paperless Workflows** under Settings → Devices & services. Afterwards use
**Configure** on the integration to add or edit views.

Use **Reconfigure** to replace the URL or API token later. Leaving the token
field empty keeps the current credential and never changes the document views.

The API token needs read access to documents, tags, correspondents, document
types, storage paths, and custom fields. Owner names are loaded when the token
may list users; otherwise owner IDs remain usable. Keep TLS verification enabled.

## Safety and scale

- Every API page is followed, so counts and sums are complete.
- Pagination keeps only Paperless' `/api/` path and query and rewrites them to
  the configured public origin. This supports reverse proxies without ever
  forwarding the token to the host reported by the server.
- The token is stored in Home Assistant's config entry and never exposed as an
  entity attribute.
- Mixed currencies are never silently combined; each currency gets its own
  total in attributes and the default currency is used as the sensor state.
- Document attributes are capped at 50 documents and approximately 14 KB.

## Development

Run the pure unit tests without a Home Assistant installation:

```bash
python3 -m unittest discover -s tests -v
```
