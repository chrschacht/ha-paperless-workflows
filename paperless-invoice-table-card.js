class PaperlessInvoiceTableCard extends HTMLElement {
  setConfig(config) {
    if (!config?.entity) throw new Error("entity is required");
    this.config = {
      amount_entity: "sensor.paperless_workflows_zu_bezahlen_summe_betrag",
      due_date_field: "Fälligkeitsdatum",
      default_sort: "due_date",
      default_direction: "asc",
      secondary_sort: "created",
      secondary_direction: "asc",
      ...config,
    };
    this.sortKey ??= this.config.default_sort;
    this.sortDirection ??= this.config.default_direction;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return 5;
  }

  static getStubConfig() {
    return { entity: "sensor.paperless_workflows_zu_bezahlen" };
  }

  normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("de-DE")
      .trim();
  }

  customField(document, requestedName) {
    const fields = document?.custom_fields || {};
    const target = this.normalize(requestedName);
    const key = Object.keys(fields).find((name) => this.normalize(name) === target);
    return key ? fields[key] : null;
  }

  amountValue(document) {
    const raw = this.customField(document, "Betrag");
    if (raw === null || raw === undefined || raw === "") return null;
    const cleaned = String(raw)
      .toUpperCase()
      .replace("EUR", "")
      .replace("€", "")
      .replace(/\s/g, "")
      .replace(",", ".");
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
  }

  dateValue(value) {
    if (!value) return null;
    const text = String(value).trim();
    const iso = /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0];
    if (iso) return iso;
    const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    if (german) {
      return `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`;
    }
    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10);
  }

  formatDate(value) {
    const iso = this.dateValue(value);
    if (!iso) return "—";
    const [year, month, day] = iso.split("-");
    return `${day}.${month}.${year}`;
  }

  formatAmount(value) {
    if (!Number.isFinite(value)) return "—";
    return `${new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)} EUR`;
  }

  escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  fieldValue(document, key) {
    if (key === "title") return this.normalize(document.title);
    if (key === "correspondent") return this.normalize(document.correspondent);
    if (key === "created") return this.dateValue(document.created);
    if (key === "due_date") {
      return this.dateValue(this.customField(document, this.config.due_date_field));
    }
    if (key === "amount") return this.amountValue(document);
    return null;
  }

  compare(left, right, key, direction) {
    const a = this.fieldValue(left, key);
    const b = this.fieldValue(right, key);
    if (a === null || a === "") return b === null || b === "" ? 0 : 1;
    if (b === null || b === "") return -1;
    const result = typeof a === "number"
      ? a - b
      : String(a).localeCompare(String(b), "de-DE", { numeric: true, sensitivity: "base" });
    return direction === "desc" ? -result : result;
  }

  sortedDocuments(documents) {
    return [...documents].sort((left, right) => {
      const primary = this.compare(left, right, this.sortKey, this.sortDirection);
      if (primary) return primary;
      if (this.sortKey === this.config.secondary_sort) return 0;
      return this.compare(
        left,
        right,
        this.config.secondary_sort,
        this.config.secondary_direction,
      );
    });
  }

  selectSort(key) {
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
    } else {
      this.sortKey = key;
      this.sortDirection = key === "due_date" || key === "title" || key === "correspondent"
        ? "asc"
        : "desc";
    }
    this.render();
  }

  header(label, key) {
    const active = this.sortKey === key;
    const arrow = active ? (this.sortDirection === "asc" ? "▲" : "▼") : "";
    const aria = active
      ? `${label}, ${this.sortDirection === "asc" ? "aufsteigend" : "absteigend"}`
      : `${label}, sortieren`;
    return `<th scope="col" class="col-${key}">
      <button type="button" data-sort="${key}" aria-label="${aria}">
        <span>${label}</span><span class="arrow" aria-hidden="true">${arrow}</span>
      </button>
    </th>`;
  }

  render() {
    if (!this.shadowRoot || !this._hass || !this.config) return;
    const state = this._hass.states[this.config.entity];
    const documents = Array.isArray(state?.attributes?.documents)
      ? state.attributes.documents
      : [];
    const sorted = this.sortedDocuments(documents);
    const accent = state?.attributes?.accent_color || "rgba(255,255,255,.42)";
    const configuredTotal = Number.parseFloat(
      this._hass.states[this.config.amount_entity]?.state,
    );
    const total = Number.isFinite(configuredTotal)
      ? configuredTotal
      : documents.reduce((sum, document) => sum + (this.amountValue(document) || 0), 0);

    const rows = sorted.map((document) => {
      const title = this.escape(document.title || "Ohne Titel");
      const correspondent = this.escape(document.correspondent || "Kein Korrespondent");
      const created = this.formatDate(document.created);
      const due = this.formatDate(this.customField(document, this.config.due_date_field));
      const amount = this.formatAmount(this.amountValue(document));
      const url = this.escape(document.url || "#");
      return `<tr>
        <td class="title"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></td>
        <td>${correspondent}</td>
        <td class="date">${created}</td>
        <td class="date">${due}</td>
        <td class="amount">${amount}</td>
      </tr>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; --accent:${accent}; color:#fff; }
        ha-card {
          --primary-text-color:#fff;
          color:#fff;
          padding:16px 20px 20px;
          overflow:hidden;
          border:1.5px solid var(--accent);
          border-radius:24px;
          background:linear-gradient(135deg,rgba(255,255,255,.10),color-mix(in srgb,var(--accent) 8%,transparent) 55%,rgba(255,255,255,.02));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.38),0 12px 32px rgba(0,0,0,.15);
          backdrop-filter:blur(24px) saturate(130%);
          -webkit-backdrop-filter:blur(24px) saturate(130%);
          text-shadow:0 1px 3px rgba(0,0,0,.46);
        }
        .summary {
          display:grid;
          grid-template-columns:minmax(0,1fr) max-content;
          align-items:baseline;
          gap:18px;
          padding:2px 2px 14px;
          border-bottom:1px solid color-mix(in srgb,var(--accent) 68%,white);
          font-size:16px;
          font-weight:700;
        }
        .summary .total {
          text-align:right;
          white-space:nowrap;
          font-size:18px;
          font-variant-numeric:tabular-nums;
        }
        .hint {
          margin:14px 2px 12px;
          color:rgba(255,255,255,.76);
          font-size:13px;
          font-style:italic;
        }
        table { width:100%; border-collapse:collapse; table-layout:fixed; border:0; }
        tr, th, td { border:0; box-sizing:border-box; }
        thead tr, tbody tr { border-bottom:1px solid rgba(255,255,255,.22); }
        tbody tr:last-child { border-bottom:0; }
        th { padding:8px 6px; background:rgba(255,255,255,.035); }
        th:first-child, td:first-child { padding-left:2px; }
        th:last-child, td:last-child { padding-right:2px; }
        th button {
          appearance:none;
          display:flex;
          align-items:center;
          gap:5px;
          width:100%;
          padding:0;
          border:0;
          background:transparent;
          color:#fff;
          font:600 13px/1.2 inherit;
          text-align:left;
          cursor:pointer;
        }
        th:last-child button { justify-content:flex-end; text-align:right; }
        th button:hover { color:var(--accent); }
        .arrow { min-width:11px; color:var(--accent); font-size:10px; }
        td {
          padding:12px 6px;
          color:rgba(255,255,255,.92);
          overflow-wrap:anywhere;
          vertical-align:middle;
        }
        td.title, td.title a {
          color:#fff;
          font-size:18px;
          line-height:1.3;
          font-weight:650;
          text-decoration:none;
        }
        td.title a:hover { text-decoration:underline; }
        td.date { white-space:nowrap; font-variant-numeric:tabular-nums; }
        td.amount {
          text-align:right;
          white-space:nowrap;
          font-size:16px;
          font-weight:650;
          font-variant-numeric:tabular-nums;
        }
        .col-title { width:34%; }
        .col-correspondent { width:18%; }
        .col-created, .col-due_date { width:15%; }
        .col-amount { width:18%; }
        .empty { padding:18px 2px 4px; color:rgba(255,255,255,.82); }
        @media (max-width:800px) {
          ha-card { padding:14px 12px 18px; overflow-x:auto; }
          table { min-width:780px; }
        }
      </style>
      <ha-card>
        <div class="summary">
          <span>${documents.length} Dokumente</span>
          <span class="total">${this.formatAmount(total)}</span>
        </div>
        <div class="hint">Spaltenkopf anklicken, um die Sortierung zu ändern.</div>
        ${documents.length ? `<table>
          <thead><tr>
            ${this.header("Titel", "title")}
            ${this.header("Korrespondent", "correspondent")}
            ${this.header("Rechnungsdatum", "created")}
            ${this.header("Fälligkeitsdatum", "due_date")}
            ${this.header("Betrag", "amount")}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>` : '<div class="empty">✅ Keine offenen Zahlungen.</div>'}
      </ha-card>`;

    this.shadowRoot.querySelectorAll("button[data-sort]").forEach((button) => {
      button.addEventListener("click", () => this.selectSort(button.dataset.sort));
    });
  }
}

if (!customElements.get("paperless-invoice-table-card")) {
  customElements.define("paperless-invoice-table-card", PaperlessInvoiceTableCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "paperless-invoice-table-card",
  name: "Paperless Invoice Table",
  description: "Sortierbare Paperless-Rechnungstabelle mit Datums- und Betragsfeldern.",
});
