const PW_DEFAULTS = {
  title: "PAPERLESS-NGX",
  description: "Praxis-DMS",
  tags: [],
  columns: [
    { key: "standard:title", label: "Titel", font_size: 18, text_style: "bold", align: "left" },
    { key: "standard:correspondent", label: "Korrespondent", font_size: 14, text_style: "normal", align: "left" },
    { key: "standard:created", label: "Erstellt", font_size: 14, text_style: "normal", align: "left" },
  ],
  max_documents: 50,
  ordering: "created",
  default_sort: null,
  default_direction: "asc",
};

const pwEscape = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const pwColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ""))
  ? String(value).toLowerCase() : "#8e8e93";

const pwDocumentLabel = (count) => Number(count) === 1 ? "Dokument" : "Dokumente";

const pwNormalizeConfig = (config = {}) => ({
  ...PW_DEFAULTS,
  ...config,
  tags: Array.isArray(config.tags) ? config.tags.map((tag) => ({ ...tag })) : [],
  columns: Array.isArray(config.columns) && config.columns.length
    ? config.columns.map((column) => ({ ...column }))
    : PW_DEFAULTS.columns.map((column) => ({ ...column })),
});

const PW_WORKFLOW_EVENT = "paperless-workflows-selection";
const PW_WORKFLOW_STATE = window.__paperlessWorkflowSelections || new Map();
window.__paperlessWorkflowSelections = PW_WORKFLOW_STATE;

const pwGlassStyle = `
  :host{display:block;color:#fff;font-family:var(--paper-font-body1_-_font-family,system-ui)}
  ha-card{height:100%;overflow:hidden;border:1px solid rgba(255,255,255,.46);border-radius:28px;background:linear-gradient(135deg,rgba(255,255,255,.13),rgba(255,255,255,.035));box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 18px 46px rgba(0,0,0,.16);backdrop-filter:blur(28px) saturate(138%);-webkit-backdrop-filter:blur(28px) saturate(138%);color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.38)}
`;

const pwEditorStyle = `
  :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,system-ui)}
  .editor{display:grid;gap:18px;padding:8px 2px 18px}.section{padding:16px;border:1px solid var(--divider-color);border-radius:16px;background:var(--card-background-color)}h3{margin:0 0 12px;font-size:16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}label{display:grid;gap:5px;font-size:12px;color:var(--secondary-text-color)}input,select{box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--divider-color);border-radius:10px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}.add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin:0 0 10px}.add button,.buttons button{border:1px solid var(--divider-color);border-radius:10px;background:var(--secondary-background-color);color:var(--primary-text-color);cursor:pointer}.add button{padding:0 16px}.row{display:flex;align-items:center;gap:10px;margin-top:8px;padding:10px;border:1px solid var(--divider-color);border-radius:13px;background:var(--secondary-background-color)}.row.dragging{opacity:.45}.handle{cursor:grab;color:var(--secondary-text-color);font-size:18px}.grow{display:grid;grid-template-columns:minmax(110px,1fr) minmax(130px,1fr);align-items:center;gap:8px;flex:1}.grow small{text-align:right}.buttons{display:flex;gap:5px}.buttons button{width:32px;height:32px;font-size:16px}.column{align-items:flex-start}.column-fields{display:grid;grid-template-columns:minmax(150px,1.5fr) 90px 110px 110px;gap:8px;flex:1}.hint{margin:4px 0 0;color:var(--secondary-text-color);font-size:12px}.error{color:var(--error-color)}@media(max-width:700px){.grid,.column-fields{grid-template-columns:1fr}.grow{grid-template-columns:1fr}.grow small{text-align:left}.row{align-items:flex-start;flex-wrap:wrap}.buttons{margin-left:auto}}
`;

class PaperlessCardBase extends HTMLElement {
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this.loadInstances();
    else this.hassUpdated();
  }

  async loadInstances() {
    if (!this._hass || this._loadingInstances) return;
    this._loadingInstances = true;
    try {
      const response = await this._hass.callWS({ type: "paperless_workflows/instances" });
      this._instances = response.instances || [];
      this._instance = this._instances.find((item) => item.entry_id === this.config?.instance_id)
        || (this._instances.length === 1 ? this._instances[0] : null);
      this._error = null;
      this.instancesLoaded();
    } catch (error) {
      this._error = error?.message || String(error);
      this.render();
    } finally { this._loadingInstances = false; }
  }

  instancesLoaded() { this.render(); }
  hassUpdated() {}
}

class PaperlessEditorBase extends HTMLElement {
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this.loadInstances();
  }

  async loadInstances() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      const response = await this._hass.callWS({ type: "paperless_workflows/instances" });
      this.instances = response.instances || [];
      if (!this.config.instance_id && this.instances.length === 1) {
        this.config.instance_id = this.instances[0].entry_id;
        this.changed();
      }
      this.error = null;
      this.render();
    } catch (error) {
      this.error = error?.message || String(error);
      this.render();
    } finally { this._loading = false; }
  }

  get instance() { return this.instances?.find((item) => item.entry_id === this.config.instance_id) || null; }

  changed() {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: { ...this.config } }, bubbles: true, composed: true }));
  }

  update(mutator) { mutator(this.config); this.changed(); this.render(); }

  instanceOptions() {
    return (this.instances || []).map((item) => `<option value="${pwEscape(item.entry_id)}" ${item.entry_id === this.config.instance_id ? "selected" : ""}>${pwEscape(item.title)} · ${pwEscape(item.dns_name)}</option>`).join("");
  }
}

class PaperlessWorkspaceCard extends HTMLElement {
  static getStubConfig() { return pwNormalizeConfig(); }

  static async getConfigElement() {
    return document.createElement("paperless-workspace-card-editor");
  }

  setConfig(config) {
    this.config = pwNormalizeConfig(config);
    this._activeTagId = this.config.default_tag_id || this.config.tags[0]?.id || null;
    this._sortKey = this.config.default_sort || null;
    this._sortDirection = this.config.default_direction || "asc";
    this._instances = null;
    this._results = new Map();
    this._loadVersion = (this._loadVersion || 0) + 1;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.render();
    this.load();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this.load();
  }

  connectedCallback() {
    this._timer = window.setInterval(() => this.refresh(), 300000);
  }

  disconnectedCallback() {
    if (this._timer) window.clearInterval(this._timer);
  }

  getCardSize() { return 8; }

  getLayoutOptions() { return { grid_columns: "full", grid_rows: 8 }; }

  async load() {
    if (!this._hass || !this.config || this._loadingInstances) return;
    const version = this._loadVersion;
    this._loadingInstances = true;
    try {
      const response = await this._hass.callWS({ type: "paperless_workflows/instances" });
      if (version !== this._loadVersion) return;
      this._instances = response.instances || [];
      this._instance = this._instances.find((item) => item.entry_id === this.config.instance_id)
        || (this._instances.length === 1 ? this._instances[0] : null);
      this._error = null;
      await this.refresh();
    } catch (error) {
      this._error = error?.message || String(error);
      this.render();
    } finally {
      this._loadingInstances = false;
    }
  }

  async refresh() {
    if (!this._hass || !this._instance || this._refreshing) return;
    const tags = this.config.tags || [];
    if (!tags.some((tag) => Number(tag.id) === Number(this._activeTagId))) {
      this._activeTagId = this.config.default_tag_id || tags[0]?.id || null;
    }
    if (!tags.length) {
      this._results = new Map();
      this.render();
      return;
    }
    this._refreshing = true;
    this.render();
    try {
      const columns = this.config.columns.map((column) => column.key);
      const responses = await Promise.all(tags.map(async (tag) => {
        const active = Number(tag.id) === Number(this._activeTagId);
        const message = {
          type: "paperless_workflows/tag_workspace",
          entry_id: this._instance.entry_id,
          tag_id: Number(tag.id),
          columns: active ? columns : [],
          ordering: this.config.ordering || "created",
          max_documents: active ? Number(this.config.max_documents || 50) : 0,
        };
        if (tag.sum_field_id !== undefined && tag.sum_field_id !== null && tag.sum_field_id !== "") {
          message.sum_field_id = Number(tag.sum_field_id);
        }
        return [Number(tag.id), await this._hass.callWS(message)];
      }));
      this._results = new Map(responses);
      this._error = null;
    } catch (error) {
      this._error = error?.message || String(error);
    } finally {
      this._refreshing = false;
      this.render();
    }
  }

  fieldDefinition(key) {
    if (!this._instance) return null;
    if (key.startsWith("standard:")) {
      const raw = key.split(":", 2)[1];
      return this._instance.document_fields.find((field) => field.key === raw) || null;
    }
    if (key.startsWith("custom:")) {
      const id = Number(key.split(":", 2)[1]);
      const field = this._instance.custom_fields.find((item) => Number(item.id) === id);
      return field ? { ...field, key, custom: true } : null;
    }
    return null;
  }

  rawValue(document, key) {
    if (key.startsWith("standard:")) return document[key.split(":", 2)[1]];
    const definition = this.fieldDefinition(key);
    return definition ? document.custom_fields?.[definition.name] : null;
  }

  dateValue(value) {
    if (!value) return null;
    const text = String(value).trim();
    const iso = /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0];
    if (iso) return iso;
    const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    if (german) return `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`;
    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10);
  }

  numberValue(value) {
    if (typeof value === "number") return value;
    const cleaned = String(value ?? "").replace(/[A-Z€$£\s]/gi, "").replace(",", ".");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  formatMoney(value, currency = this._instance?.default_currency || "EUR") {
    const number = this.numberValue(value);
    if (number === null) return "—";
    return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} ${currency}`;
  }

  formatValue(document, column) {
    const definition = this.fieldDefinition(column.key);
    const value = this.rawValue(document, column.key);
    if (value === null || value === undefined || value === "") return "—";
    if (definition?.data_type === "date" || ["created", "added", "modified"].includes(definition?.key)) {
      const iso = this.dateValue(value);
      if (!iso) return String(value);
      const [year, month, day] = iso.split("-");
      return `${day}.${month}.${year}`;
    }
    if (definition?.data_type === "monetary") return this.formatMoney(value);
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  aggregateText(result) {
    const totals = result?.aggregate?.totals;
    if (!totals) return "";
    return Object.entries(totals)
      .map(([currency, value]) => this.formatMoney(value, currency))
      .join(" · ");
  }

  liveTag(configured) {
    return this._instance?.tags.find((tag) => Number(tag.id) === Number(configured?.id))
      || configured || null;
  }

  compareDocuments(left, right) {
    if (!this._sortKey) return 0;
    const definition = this.fieldDefinition(this._sortKey);
    let a = this.rawValue(left, this._sortKey);
    let b = this.rawValue(right, this._sortKey);
    if (definition?.data_type === "date" || ["created", "added", "modified"].includes(definition?.key)) {
      a = this.dateValue(a); b = this.dateValue(b);
    } else if (["monetary", "integer", "float"].includes(definition?.data_type)) {
      a = this.numberValue(a); b = this.numberValue(b);
    }
    if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "" ? 0 : 1;
    if (b === null || b === undefined || b === "") return -1;
    const result = typeof a === "number"
      ? a - b
      : String(a).localeCompare(String(b), "de-DE", { numeric: true, sensitivity: "base" });
    return this._sortDirection === "desc" ? -result : result;
  }

  chooseTag(tagId) {
    this._activeTagId = Number(tagId);
    this._sortKey = this.config.default_sort || null;
    this._sortDirection = this.config.default_direction || "asc";
    this.refresh();
  }

  chooseSort(key) {
    if (this._sortKey === key) this._sortDirection = this._sortDirection === "asc" ? "desc" : "asc";
    else { this._sortKey = key; this._sortDirection = "asc"; }
    this.render();
  }

  render() {
    if (!this.shadowRoot || !this.config) return;
    const activeTag = this.config.tags.find((tag) => Number(tag.id) === Number(this._activeTagId));
    const result = activeTag ? this._results.get(Number(activeTag.id)) : null;
    const documents = [...(result?.documents || [])].sort((a, b) => this.compareDocuments(a, b));
    const liveActiveTag = this.liveTag(activeTag);
    const accent = pwColor(liveActiveTag?.color);
    const total = this.aggregateText(result);
    const tagButtons = this.config.tags.map((tag) => {
      const liveTag = this.liveTag(tag);
      const summary = this._results.get(Number(tag.id));
      const selected = Number(tag.id) === Number(this._activeTagId);
      const color = pwColor(liveTag?.color);
      return `<button class="tag ${selected ? "selected" : ""}" data-tag="${Number(tag.id)}" style="--tag-color:${color}">
        <span class="tag-name">${pwEscape(liveTag?.name || tag.name)}</span>
        <span class="tag-meta"><strong>${summary?.count ?? "—"}</strong> ${pwDocumentLabel(summary?.count)}</span>
        ${summary?.aggregate ? `<span class="tag-sum">${pwEscape(this.aggregateText(summary))}</span>` : ""}
      </button>`;
    }).join("");
    const headers = this.config.columns.map((column) => {
      const active = this._sortKey === column.key;
      const arrow = active ? (this._sortDirection === "asc" ? "▲" : "▼") : "";
      return `<th style="text-align:${column.align || "left"}"><button data-sort="${pwEscape(column.key)}" style="justify-content:${column.align === "right" ? "flex-end" : column.align === "center" ? "center" : "flex-start"}">${pwEscape(column.label || this.fieldDefinition(column.key)?.name || column.key)} <span>${arrow}</span></button></th>`;
    }).join("");
    const rows = documents.map((document) => `<tr>${this.config.columns.map((column) => {
      const value = pwEscape(this.formatValue(document, column));
      const weight = column.text_style === "bold" ? 700 : 400;
      const style = column.text_style === "italic" ? "italic" : "normal";
      const content = column.key === "standard:title"
        ? `<a href="${pwEscape(document.url || "#")}" target="_blank" rel="noopener noreferrer">${value}</a>` : value;
      return `<td style="font-size:${Number(column.font_size || 14)}px;font-weight:${weight};font-style:${style};text-align:${column.align || "left"}">${content}</td>`;
    }).join("")}</tr>`).join("");

    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:#fff;--accent:${accent};font-family:var(--paper-font-body1_-_font-family,system-ui)}
      ha-card{overflow:hidden;border:1px solid rgba(255,255,255,.46);border-radius:28px;background:linear-gradient(135deg,rgba(255,255,255,.13),rgba(255,255,255,.035));box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 18px 46px rgba(0,0,0,.16);backdrop-filter:blur(28px) saturate(138%);-webkit-backdrop-filter:blur(28px) saturate(138%);color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.38)}
      .header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:24px 26px 20px;border-bottom:1px solid rgba(255,255,255,.28)}
      .title{margin:0 0 3px;font-size:28px;line-height:1.1}.description{font-size:15px;opacity:.82}.dns{color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,.42);border-radius:999px;padding:9px 13px;background:rgba(255,255,255,.07);white-space:nowrap}.dns:hover{background:rgba(255,255,255,.14)}
      .workspace{display:grid;grid-template-columns:minmax(220px,290px) minmax(0,1fr);min-height:390px}.sidebar{padding:18px;border-right:1px solid rgba(255,255,255,.25)}.sidebar-label{padding:0 4px 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.68}.tag{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;width:100%;margin:0 0 10px;padding:14px 15px;border:1.25px solid var(--tag-color);border-radius:19px;background:linear-gradient(135deg,rgba(255,255,255,.10),color-mix(in srgb,var(--tag-color) 8%,transparent));color:#fff;text-align:left;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.32);transition:.16s ease}.tag:hover{transform:translateY(-1px);background:linear-gradient(135deg,rgba(255,255,255,.15),color-mix(in srgb,var(--tag-color) 13%,transparent))}.tag.selected{border-width:2.5px;box-shadow:inset 4px 0 0 var(--tag-color),0 8px 25px color-mix(in srgb,var(--tag-color) 24%,transparent)}.tag-name{grid-column:1;grid-row:1;display:block;min-width:0;font-size:16px;font-weight:700}.tag-meta{grid-column:1 / -1;grid-row:2;display:block;margin-top:5px;font-size:12px;opacity:.82}.tag-sum{grid-column:2;grid-row:1;display:block;margin-left:12px;font-size:14px;font-weight:650;opacity:1;text-align:right;white-space:nowrap}
      .details{min-width:0;padding:18px 22px 24px}.detail-head{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:baseline;gap:18px;padding:4px 2px 15px;border-bottom:1px solid color-mix(in srgb,var(--accent) 70%,white)}.detail-title{font-size:20px;font-weight:750}.detail-total{text-align:right;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}.loading{font-size:12px;opacity:.72}.error,.empty,.setup{margin:22px 2px;color:rgba(255,255,255,.84)}.error{color:#ffb4ab}
      .table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;table-layout:auto}thead tr,tbody tr{border-bottom:1px solid rgba(255,255,255,.21)}tbody tr:last-child{border-bottom:0}th{padding:11px 8px;background:rgba(255,255,255,.03)}th button{appearance:none;display:flex;align-items:center;gap:5px;width:100%;padding:0;border:0;background:transparent;color:#fff;font:650 13px/1.2 inherit;cursor:pointer}th button:hover{color:var(--accent)}td{padding:13px 8px;color:rgba(255,255,255,.94);vertical-align:middle;overflow-wrap:anywhere}td a{color:#fff;text-decoration:none}td a:hover{text-decoration:underline}
      @media(max-width:800px){.header{align-items:flex-start;flex-direction:column}.workspace{grid-template-columns:1fr}.sidebar{border-right:0;border-bottom:1px solid rgba(255,255,255,.25)}.details{padding:16px 14px 22px}.table-wrap table{min-width:720px}}
    </style><ha-card>
      <div class="header"><div><div class="title">${pwEscape(this.config.title)}</div><div class="description">${pwEscape(this.config.description)}</div></div>${this._instance ? `<a class="dns" href="${pwEscape(this._instance.url)}" target="_blank" rel="noopener noreferrer">${pwEscape(this._instance.dns_name)}</a>` : ""}</div>
      ${this._error ? `<div class="details error">${pwEscape(this._error)}</div>` : !this._instance ? `<div class="details setup">Bitte im Karteneditor eine Paperless-Instanz auswählen.</div>` : !this.config.tags.length ? `<div class="details setup">Bitte im Karteneditor mindestens einen Tag hinzufügen.</div>` : `<div class="workspace"><aside class="sidebar"><div class="sidebar-label">Dokumenten-Workflows</div>${tagButtons}</aside><main class="details"><div class="detail-head"><div class="detail-title">${pwEscape(liveActiveTag?.name || activeTag?.name || "Dokumente")} · ${result?.count ?? "—"} ${pwDocumentLabel(result?.count)} ${this._refreshing ? '<span class="loading">Wird aktualisiert …</span>' : ""}</div><div class="detail-total">${pwEscape(total)}</div></div>${documents.length ? `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${this._refreshing ? "Dokumente werden geladen …" : "Keine Dokumente vorhanden."}</div>`}</main></div>`}
    </ha-card>`;
    this.shadowRoot.querySelectorAll("[data-tag]").forEach((button) => button.addEventListener("click", () => this.chooseTag(button.dataset.tag)));
    this.shadowRoot.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => this.chooseSort(button.dataset.sort)));
  }
}

class PaperlessWorkspaceCardEditor extends HTMLElement {
  setConfig(config) {
    this.config = pwNormalizeConfig(config);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.loadInstances();
    this.render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this.loadInstances();
  }

  async loadInstances() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      const response = await this._hass.callWS({ type: "paperless_workflows/instances" });
      this.instances = response.instances || [];
      if (!this.config.instance_id && this.instances.length === 1) {
        this.config.instance_id = this.instances[0].entry_id;
        this.changed();
      }
      this.render();
    } catch (error) {
      this.error = error?.message || String(error);
      this.render();
    } finally { this._loading = false; }
  }

  get instance() {
    return this.instances?.find((item) => item.entry_id === this.config.instance_id) || null;
  }

  changed() {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: { ...this.config } }, bubbles: true, composed: true }));
  }

  update(mutator) {
    mutator(this.config);
    this.changed();
    this.render();
  }

  fieldOptions() {
    if (!this.instance) return [];
    return [
      ...this.instance.document_fields.map((field) => ({ ...field, optionKey: `standard:${field.key}` })),
      ...this.instance.custom_fields.map((field) => ({ ...field, optionKey: `custom:${field.id}` })),
    ];
  }

  defaultColumn(field) {
    const monetary = field.data_type === "monetary";
    const title = field.optionKey === "standard:title";
    return {
      key: field.optionKey, label: field.name,
      font_size: title ? 18 : monetary ? 16 : 14,
      text_style: title || monetary ? "bold" : "normal",
      align: monetary ? "right" : "left",
    };
  }

  move(kind, from, to) {
    const list = [...this.config[kind]];
    if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
    const [item] = list.splice(from, 1); list.splice(to, 0, item);
    this.update((config) => { config[kind] = list; });
  }

  render() {
    if (!this.shadowRoot || !this.config) return;
    const instanceOptions = (this.instances || []).map((item) => `<option value="${pwEscape(item.entry_id)}" ${item.entry_id === this.config.instance_id ? "selected" : ""}>${pwEscape(item.title)} · ${pwEscape(item.dns_name)}</option>`).join("");
    const chosenTags = new Set(this.config.tags.map((tag) => Number(tag.id)));
    const availableTags = (this.instance?.tags || []).filter((tag) => !chosenTags.has(Number(tag.id)));
    const monetary = (this.instance?.custom_fields || []).filter((field) => field.data_type === "monetary");
    const tagRows = this.config.tags.map((configured, index) => {
      const live = this.instance?.tags.find((tag) => Number(tag.id) === Number(configured.id));
      const name = live?.name || configured.name || `Tag #${configured.id}`;
      const sumOptions = monetary.map((field) => `<option value="${field.id}" ${Number(configured.sum_field_id) === Number(field.id) ? "selected" : ""}>${pwEscape(field.name)}</option>`).join("");
      return `<div class="row draggable" draggable="true" data-kind="tags" data-index="${index}"><span class="handle" title="Ziehen">⋮⋮</span><span class="grow"><strong>${pwEscape(name)}</strong><small>Summenfeld</small><select data-action="tag-sum" data-index="${index}"><option value="">Keine Summe</option>${sumOptions}</select></span><span class="buttons"><button data-action="up" data-kind="tags" data-index="${index}" title="Nach oben">↑</button><button data-action="down" data-kind="tags" data-index="${index}" title="Nach unten">↓</button><button data-action="remove-tag" data-index="${index}" title="Entfernen">×</button></span></div>`;
    }).join("");
    const fields = this.fieldOptions();
    const chosenFields = new Set(this.config.columns.map((column) => column.key));
    const availableFields = fields.filter((field) => !chosenFields.has(field.optionKey));
    const columnRows = this.config.columns.map((column, index) => `<div class="row draggable column" draggable="true" data-kind="columns" data-index="${index}"><span class="handle" title="Ziehen">⋮⋮</span><div class="column-fields"><label>Spalte<input data-action="column-label" data-index="${index}" value="${pwEscape(column.label)}"></label><label>Größe (px)<input type="number" min="10" max="40" data-action="column-size" data-index="${index}" value="${Number(column.font_size || 14)}"></label><label>Schrift<select data-action="column-style" data-index="${index}"><option value="normal" ${column.text_style === "normal" ? "selected" : ""}>Normal</option><option value="bold" ${column.text_style === "bold" ? "selected" : ""}>Fett</option><option value="italic" ${column.text_style === "italic" ? "selected" : ""}>Kursiv</option></select></label><label>Ausrichtung<select data-action="column-align" data-index="${index}"><option value="left" ${column.align === "left" ? "selected" : ""}>Links</option><option value="center" ${column.align === "center" ? "selected" : ""}>Zentriert</option><option value="right" ${column.align === "right" ? "selected" : ""}>Rechts</option></select></label></div><span class="buttons"><button data-action="up" data-kind="columns" data-index="${index}" title="Nach oben">↑</button><button data-action="down" data-kind="columns" data-index="${index}" title="Nach unten">↓</button><button data-action="remove-column" data-index="${index}" title="Entfernen">×</button></span></div>`).join("");
    const defaultOptions = this.config.tags.map((tag) => `<option value="${tag.id}" ${Number(this.config.default_tag_id) === Number(tag.id) ? "selected" : ""}>${pwEscape(tag.name)}</option>`).join("");

    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,system-ui)}.editor{display:grid;gap:18px;padding:8px 2px 18px}.section{padding:16px;border:1px solid var(--divider-color);border-radius:16px;background:var(--card-background-color)}h3{margin:0 0 12px;font-size:16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}label{display:grid;gap:5px;font-size:12px;color:var(--secondary-text-color)}input,select{box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--divider-color);border-radius:10px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}.add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin:0 0 10px}.add button,.buttons button{border:1px solid var(--divider-color);border-radius:10px;background:var(--secondary-background-color);color:var(--primary-text-color);cursor:pointer}.add button{padding:0 16px}.row{display:flex;align-items:center;gap:10px;margin-top:8px;padding:10px;border:1px solid var(--divider-color);border-radius:13px;background:var(--secondary-background-color)}.row.dragging{opacity:.45}.handle{cursor:grab;color:var(--secondary-text-color);font-size:18px}.grow{display:grid;grid-template-columns:minmax(110px,1fr) minmax(130px,1fr);align-items:center;gap:8px;flex:1}.grow small{text-align:right}.buttons{display:flex;gap:5px}.buttons button{width:32px;height:32px;font-size:16px}.column{align-items:flex-start}.column-fields{display:grid;grid-template-columns:minmax(150px,1.5fr) 90px 110px 110px;gap:8px;flex:1}.hint{margin:4px 0 0;color:var(--secondary-text-color);font-size:12px}.error{color:var(--error-color)}@media(max-width:700px){.grid,.column-fields{grid-template-columns:1fr}.grow{grid-template-columns:1fr}.grow small{text-align:left}.row{align-items:flex-start;flex-wrap:wrap}.buttons{margin-left:auto}}
    </style><div class="editor">
      <div class="section"><h3>Paperless-Instanz</h3><label>Instanz<select data-action="instance"><option value="">Bitte auswählen</option>${instanceOptions}</select></label>${this.error ? `<p class="error">${pwEscape(this.error)}</p>` : '<p class="hint">URL und API-Key werden unter Einstellungen → Geräte & Dienste → Paperless Workflows verwaltet.</p>'}</div>
      <div class="section"><h3>Header</h3><div class="grid"><label>Titel<input data-action="title" value="${pwEscape(this.config.title)}"></label><label>Beschreibung<input data-action="description" value="${pwEscape(this.config.description)}"></label></div><p class="hint">Der DNS-Name wird automatisch aus der URL der ausgewählten Instanz ermittelt.</p></div>
      <div class="section"><h3>Tag-Liste · links</h3><div class="add"><select data-add="tag"><option value="">Tag auswählen …</option>${availableTags.map((tag) => `<option value="${tag.id}">${pwEscape(tag.name)}</option>`).join("")}</select><button data-action="add-tag">Hinzufügen</button></div>${tagRows || '<p class="hint">Noch keine Tags ausgewählt.</p>'}<label style="margin-top:12px">Beim Öffnen ausgewählter Tag<select data-action="default-tag"><option value="">Erster Tag</option>${defaultOptions}</select></label><p class="hint">Tags können mit dem Griff oder den Pfeilen verschoben werden. Als Summenfelder stehen ausschließlich Paperless-Felder vom Typ „Betrag“ zur Verfügung.</p></div>
      <div class="section"><h3>Tag-Details · rechts</h3><div class="add"><select data-add="column"><option value="">Feld auswählen …</option>${availableFields.map((field) => `<option value="${pwEscape(field.optionKey)}">${pwEscape(field.name)}${field.optionKey.startsWith("custom:") ? " · Custom Field" : ""}</option>`).join("")}</select><button data-action="add-column">Hinzufügen</button></div>${columnRows || '<p class="hint">Noch keine Spalten ausgewählt.</p>'}<div class="grid" style="margin-top:12px"><label>Maximale Dokumente<input type="number" min="1" max="100" data-action="max-documents" value="${Number(this.config.max_documents || 50)}"></label><label>API-Sortierung<select data-action="ordering"><option value="created" ${this.config.ordering === "created" ? "selected" : ""}>Erstellt · aufsteigend</option><option value="-created" ${this.config.ordering === "-created" ? "selected" : ""}>Erstellt · absteigend</option><option value="title" ${this.config.ordering === "title" ? "selected" : ""}>Titel · A–Z</option><option value="-modified" ${this.config.ordering === "-modified" ? "selected" : ""}>Zuletzt geändert</option></select></label></div><p class="hint">Die Spaltenreihenfolge kann per Drag & Drop geändert werden. Im fertigen Dashboard lässt sich zusätzlich durch Klick auf einen Spaltenkopf sortieren.</p></div>
    </div>`;
    this.bindEvents();
  }

  bindEvents() {
    const root = this.shadowRoot;
    root.querySelectorAll("input[data-action]").forEach((element) => element.addEventListener("input", (event) => {
      const action = event.target.dataset.action;
      const value = event.target.value;
      const index = Number(event.target.dataset.index);
      if (action === "title" || action === "description") this.config[action] = value;
      else if (action === "max-documents") this.config.max_documents = Math.max(1, Math.min(100, Number(value) || 50));
      else if (action === "column-label") this.config.columns[index].label = value;
      else if (action === "column-size") this.config.columns[index].font_size = Math.max(10, Math.min(40, Number(value) || 14));
      else return;
      this.changed();
    }));
    root.querySelectorAll("input[data-action],select[data-action]").forEach((element) => element.addEventListener("change", (event) => {
      const action = event.target.dataset.action; const value = event.target.value; const index = Number(event.target.dataset.index);
      if (action === "instance") this.update((config) => { config.instance_id = value; config.tags = []; config.columns = PW_DEFAULTS.columns.map((column) => ({ ...column })); config.default_tag_id = null; });
      else if (action === "title" || action === "description" || action === "ordering") this.update((config) => { config[action] = value; });
      else if (action === "max-documents") this.update((config) => { config.max_documents = Math.max(1, Math.min(100, Number(value) || 50)); });
      else if (action === "default-tag") this.update((config) => { config.default_tag_id = value ? Number(value) : null; });
      else if (action === "tag-sum") this.update((config) => { config.tags[index].sum_field_id = value ? Number(value) : null; });
      else if (action === "column-label") this.update((config) => { config.columns[index].label = value; });
      else if (action === "column-size") this.update((config) => { config.columns[index].font_size = Math.max(10, Math.min(40, Number(value) || 14)); });
      else if (action === "column-style") this.update((config) => { config.columns[index].text_style = value; });
      else if (action === "column-align") this.update((config) => { config.columns[index].align = value; });
    }));
    root.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action; const index = Number(button.dataset.index); const kind = button.dataset.kind;
      if (action === "add-tag") {
        const id = Number(root.querySelector('[data-add="tag"]').value); const tag = this.instance?.tags.find((item) => Number(item.id) === id); if (tag) this.update((config) => { config.tags.push({ id, name: tag.name, color: tag.color, sum_field_id: null }); if (!config.default_tag_id) config.default_tag_id = id; });
      } else if (action === "add-column") {
        const key = root.querySelector('[data-add="column"]').value; const field = this.fieldOptions().find((item) => item.optionKey === key); if (field) this.update((config) => { config.columns.push(this.defaultColumn(field)); });
      } else if (action === "remove-tag") this.update((config) => { config.tags.splice(index, 1); if (!config.tags.some((tag) => Number(tag.id) === Number(config.default_tag_id))) config.default_tag_id = config.tags[0]?.id || null; });
      else if (action === "remove-column") this.update((config) => { config.columns.splice(index, 1); });
      else if (action === "up") this.move(kind, index, index - 1);
      else if (action === "down") this.move(kind, index, index + 1);
    }));
    let dragged = null;
    root.querySelectorAll(".draggable").forEach((row) => {
      row.addEventListener("dragstart", () => { dragged = { kind: row.dataset.kind, index: Number(row.dataset.index) }; row.classList.add("dragging"); });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => { event.preventDefault(); if (dragged?.kind === row.dataset.kind) this.move(dragged.kind, dragged.index, Number(row.dataset.index)); dragged = null; });
    });
  }
}

class PaperlessHeaderCard extends PaperlessCardBase {
  static getStubConfig() { return { title: "PAPERLESS-NGX", description: "Praxis-DMS", badges: [] }; }
  static async getConfigElement() { return document.createElement("paperless-header-card-editor"); }

  setConfig(config) {
    this.config = { title: "PAPERLESS-NGX", description: "Praxis-DMS", badges: [], ...config, badges: Array.isArray(config.badges) ? config.badges.map((badge) => ({ ...badge })) : [] };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.render(); this.loadInstances();
  }

  getCardSize() { return 2; }
  getLayoutOptions() { return { grid_columns: "full", grid_rows: 2 }; }
  hassUpdated() { this.render(); }

  badgeState(badge) {
    const stateObject = this._hass?.states?.[badge.entity];
    if (!stateObject) return { state: "Nicht verfügbar", ok: false, missing: true };
    const raw = String(stateObject.state ?? "");
    const state = this._hass?.formatEntityState?.(stateObject) || raw;
    const okValues = String(badge.ok_state ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    return { state, ok: !badge.status || okValues.includes(raw.toLowerCase()), missing: false };
  }

  showMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  render() {
    if (!this.shadowRoot || !this.config) return;
    const badgeRows = [1, 2].map((row) => {
      const badges = this.config.badges.filter((badge) => Number(badge.row || 1) === row).map((badge, index) => {
        const state = this.badgeState(badge);
        const kind = badge.status ? (state.ok ? "ok" : "error") : "neutral";
        const size = ["small", "medium", "large"].includes(badge.size) ? badge.size : (badge.status ? "medium" : "small");
        return `<button class="badge ${kind} ${size}" data-entity="${pwEscape(badge.entity)}"><ha-icon icon="${pwEscape(badge.icon || "mdi:information-outline")}"></ha-icon><span class="badge-text"><span class="badge-name">${pwEscape(badge.name || badge.entity || `Badge ${index + 1}`)}</span><span class="badge-state">${pwEscape(state.state)}</span></span></button>`;
      }).join("");
      return badges ? `<div class="badge-row row-${row}">${badges}</div>` : "";
    }).join("");
    this.shadowRoot.innerHTML = `<style>${pwGlassStyle}.header{display:grid;grid-template-columns:minmax(230px,1fr) auto;align-items:center;gap:24px;padding:20px 24px}.identity{align-self:center}.title{margin:0 0 3px;font-size:28px;line-height:1.1}.description{font-size:15px;opacity:.82}.dns{display:inline-block;margin-top:8px;color:#fff;text-decoration:none;font-size:12px;opacity:.82}.dns:hover{opacity:1;text-decoration:underline}.badges{display:grid;justify-items:end;gap:8px;min-width:0}.badge-row{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.badge{appearance:none;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:9px;height:58px;padding:0 13px;border:1px solid rgba(255,255,255,.34);border-radius:29px;background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.045) 60%,rgba(255,255,255,.025));box-shadow:inset 0 1px 0 rgba(255,255,255,.40),inset 0 -1px 0 rgba(255,255,255,.08),0 8px 22px rgba(0,0,0,.14);backdrop-filter:blur(24px) saturate(128%);-webkit-backdrop-filter:blur(24px) saturate(128%);color:#fff;text-align:left;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.42)}.badge.small{width:142px}.badge.medium{width:172px}.badge.large{width:210px}.badge.ok{--badge-tint:rgba(48,209,88,.075);--badge-edge:rgba(132,255,167,.44);border-color:var(--badge-edge);background:linear-gradient(180deg,rgba(255,255,255,.14),var(--badge-tint) 58%,rgba(255,255,255,.035))}.badge.error{--badge-tint:rgba(255,69,58,.10);--badge-edge:rgba(255,140,135,.50);border-color:var(--badge-edge);background:linear-gradient(180deg,rgba(255,255,255,.14),var(--badge-tint) 58%,rgba(255,255,255,.035))}.badge:hover{transform:translateY(-1px);background-color:rgba(255,255,255,.06)}.badge ha-icon{flex:0 0 auto;color:#fff;--mdc-icon-size:19px}.badge-text{display:flex;flex:1 1 auto;min-width:0;flex-direction:column;align-items:flex-start;line-height:1.15}.badge-name,.badge-state{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.badge-name{font-size:11px;font-weight:650}.badge-state{margin-top:3px;font-size:12px;color:rgba(255,255,255,.84)}.error-message{padding:0 26px 18px;color:#ffb4ab}@media(max-width:1050px){.header{grid-template-columns:1fr}.badges{justify-items:start}.badge-row{justify-content:flex-start}}@media(max-width:600px){.badge.small,.badge.medium,.badge.large{width:calc(50% - 4px);min-width:138px}.badge-row{width:100%}}</style><ha-card><div class="header"><div class="identity"><div class="title">${pwEscape(this.config.title)}</div><div class="description">${pwEscape(this.config.description)}</div>${this._instance ? `<a class="dns" href="${pwEscape(this._instance.url)}" target="_blank" rel="noopener noreferrer">${pwEscape(this._instance.dns_name)}</a>` : ""}</div>${badgeRows ? `<div class="badges">${badgeRows}</div>` : ""}</div>${this._error ? `<div class="error-message">${pwEscape(this._error)}</div>` : ""}</ha-card>`;
    this.shadowRoot.querySelectorAll("[data-entity]").forEach((badge) => badge.addEventListener("click", () => this.showMoreInfo(badge.dataset.entity)));
  }
}

class PaperlessHeaderCardEditor extends PaperlessEditorBase {
  setConfig(config) {
    this.config = { title: "PAPERLESS-NGX", description: "Praxis-DMS", badges: [], ...config, badges: Array.isArray(config.badges) ? config.badges.map((badge) => ({ ...badge })) : [] };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.loadInstances(); this.render();
  }

  render() {
    if (!this.shadowRoot || !this.config) return;
    const entityOptions = Object.keys(this._hass?.states || {}).sort().map((entity) => `<option value="${pwEscape(entity)}"></option>`).join("");
    const badgeRows = this.config.badges.map((badge, index) => `<div class="row draggable column" draggable="true" data-index="${index}"><span class="handle">⋮⋮</span><div class="badge-fields"><label>Entity<input list="paperless-entities" data-action="badge-entity" data-index="${index}" value="${pwEscape(badge.entity || "")}"></label><label>Titel<input data-action="badge-name" data-index="${index}" value="${pwEscape(badge.name || "")}"></label><label>Icon<input data-action="badge-icon" data-index="${index}" value="${pwEscape(badge.icon || "mdi:information-outline")}"></label><label>Art<select data-action="badge-status" data-index="${index}"><option value="status" ${badge.status ? "selected" : ""}>Status</option><option value="info" ${!badge.status ? "selected" : ""}>Information</option></select></label><label>OK-Zustand<input data-action="badge-ok" data-index="${index}" value="${pwEscape(badge.ok_state ?? "on")}" ${badge.status ? "" : "disabled"}></label><label>Größe<select data-action="badge-size" data-index="${index}"><option value="small" ${badge.size === "small" ? "selected" : ""}>Klein</option><option value="medium" ${badge.size === "medium" ? "selected" : ""}>Mittel</option><option value="large" ${badge.size === "large" ? "selected" : ""}>Groß</option></select></label><label>Zeile<select data-action="badge-row" data-index="${index}"><option value="1" ${Number(badge.row || 1) === 1 ? "selected" : ""}>1 · Status</option><option value="2" ${Number(badge.row || 1) === 2 ? "selected" : ""}>2 · Inhalt</option></select></label></div><span class="buttons"><button data-action="up" data-index="${index}">↑</button><button data-action="down" data-index="${index}">↓</button><button data-action="remove" data-index="${index}">×</button></span></div>`).join("");
    this.shadowRoot.innerHTML = `<style>${pwEditorStyle}.badge-fields{display:grid;grid-template-columns:minmax(210px,1.5fr) minmax(130px,1fr) minmax(150px,1fr) 105px 110px 90px 105px;gap:8px;flex:1}@media(max-width:900px){.badge-fields{grid-template-columns:1fr 1fr}}@media(max-width:600px){.badge-fields{grid-template-columns:1fr}}</style><datalist id="paperless-entities">${entityOptions}</datalist><div class="editor"><div class="section"><h3>Paperless-Header</h3><label>Instanz<select data-action="instance"><option value="">Bitte auswählen</option>${this.instanceOptions()}</select></label><div class="grid" style="margin-top:12px"><label>Titel<input data-action="title" value="${pwEscape(this.config.title)}"></label><label>Beschreibung<input data-action="description" value="${pwEscape(this.config.description)}"></label></div><p class="hint">Der DNS-Name und das Linkziel werden automatisch aus der ausgewählten Paperless-Instanz ermittelt.</p>${this.error ? `<p class="error">${pwEscape(this.error)}</p>` : ""}</div><div class="section"><h3>Status- und Informations-Badges</h3><button class="add-badge" data-action="add-badge">Badge hinzufügen</button>${badgeRows || '<p class="hint">Noch keine Badges ausgewählt.</p>'}<p class="hint">Status-Badges wechseln bei ihrem OK-Zustand zu grün, sonst zu rot. Mehrere gültige Zustände können kommagetrennt angegeben werden. Zeile 2 erzeugt den manuellen Umbruch vor den Inhaltsanzeigen.</p></div></div>`;
    this.shadowRoot.querySelector('[data-action="instance"]').addEventListener("change", (event) => this.update((config) => { config.instance_id = event.target.value; }));
    this.shadowRoot.querySelectorAll("input[data-action]").forEach((input) => input.addEventListener("input", (event) => {
      const action = event.target.dataset.action; const index = Number(event.target.dataset.index);
      if (action === "title" || action === "description") this.config[action] = event.target.value;
      else if (action === "badge-entity") this.config.badges[index].entity = event.target.value;
      else if (action === "badge-name") this.config.badges[index].name = event.target.value;
      else if (action === "badge-icon") this.config.badges[index].icon = event.target.value;
      else if (action === "badge-ok") this.config.badges[index].ok_state = event.target.value;
      this.changed();
    }));
    this.shadowRoot.querySelectorAll("select[data-action^='badge-']").forEach((select) => select.addEventListener("change", (event) => {
      const action = event.target.dataset.action; const index = Number(event.target.dataset.index);
      this.update((config) => {
        if (action === "badge-status") config.badges[index].status = event.target.value === "status";
        else if (action === "badge-size") config.badges[index].size = event.target.value;
        else if (action === "badge-row") config.badges[index].row = Number(event.target.value);
      });
    }));
    this.shadowRoot.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action; const index = Number(button.dataset.index);
      if (action === "add-badge") this.update((config) => { config.badges.push({ entity: "", name: "Neues Badge", icon: "mdi:information-outline", status: false, ok_state: "on", size: "small", row: 2 }); });
      else if (action === "remove") this.update((config) => { config.badges.splice(index, 1); });
      else if (action === "up" || action === "down") { const target = action === "up" ? index - 1 : index + 1; if (target >= 0 && target < this.config.badges.length) { const badges = [...this.config.badges]; const [item] = badges.splice(index, 1); badges.splice(target, 0, item); this.update((config) => { config.badges = badges; }); } }
    }));
    let dragged = null;
    this.shadowRoot.querySelectorAll(".draggable").forEach((row) => { row.addEventListener("dragstart", () => { dragged = Number(row.dataset.index); row.classList.add("dragging"); }); row.addEventListener("dragend", () => row.classList.remove("dragging")); row.addEventListener("dragover", (event) => event.preventDefault()); row.addEventListener("drop", (event) => { event.preventDefault(); const target = Number(row.dataset.index); if (dragged !== null && dragged !== target) { const badges = [...this.config.badges]; const [item] = badges.splice(dragged, 1); badges.splice(target, 0, item); this.update((config) => { config.badges = badges; }); } dragged = null; }); });
  }
}

class PaperlessWorkflowCard extends PaperlessCardBase {
  static getStubConfig() { return { workflow_id: "paperless-main", tags: [] }; }
  static async getConfigElement() { return document.createElement("paperless-workflow-card-editor"); }

  setConfig(config) {
    this.config = { workflow_id: "paperless-main", tags: [], ...config, tags: Array.isArray(config.tags) ? config.tags.map((tag) => ({ ...tag })) : [] };
    this._activeTagId = this.config.default_tag_id || this.config.tags[0]?.id || null;
    this._results = new Map();
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.render(); this.loadInstances();
  }

  instancesLoaded() { this.refresh(); }
  getCardSize() { return Math.max(3, this.config.tags.length * 2); }
  getLayoutOptions() { return { grid_columns: "full", grid_rows: "auto" }; }

  liveTag(tag) { return this._instance?.tags.find((item) => Number(item.id) === Number(tag?.id)) || tag; }

  formatMoney(value, currency = this._instance?.default_currency || "EUR") {
    const number = Number(value);
    return Number.isFinite(number) ? `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} ${currency}` : "—";
  }

  aggregateText(result) {
    return Object.entries(result?.aggregate?.totals || {}).map(([currency, value]) => this.formatMoney(value, currency)).join(" · ");
  }

  publishSelection() {
    const tag = this.config.tags.find((item) => Number(item.id) === Number(this._activeTagId));
    if (!tag || !this._instance) return;
    const detail = { workflow_id: this.config.workflow_id, entry_id: this._instance.entry_id, tag: { ...tag, ...this.liveTag(tag) } };
    PW_WORKFLOW_STATE.set(this.config.workflow_id, detail);
    window.dispatchEvent(new CustomEvent(PW_WORKFLOW_EVENT, { detail }));
  }

  async refresh() {
    if (!this._hass || !this._instance || this._refreshing) return;
    if (!this.config.tags.length) { this._results = new Map(); this.render(); return; }
    this._refreshing = true; this.render();
    try {
      const responses = await Promise.all(this.config.tags.map(async (tag) => {
        const message = { type: "paperless_workflows/tag_workspace", entry_id: this._instance.entry_id, tag_id: Number(tag.id), columns: [], max_documents: 0 };
        if (tag.sum_field_id !== undefined && tag.sum_field_id !== null && tag.sum_field_id !== "") message.sum_field_id = Number(tag.sum_field_id);
        return [Number(tag.id), await this._hass.callWS(message)];
      }));
      this._results = new Map(responses); this._error = null; this.publishSelection();
    } catch (error) { this._error = error?.message || String(error); }
    finally { this._refreshing = false; this.render(); }
  }

  chooseTag(id) { this._activeTagId = Number(id); this.publishSelection(); this.render(); }

  render() {
    if (!this.shadowRoot || !this.config) return;
    const buttons = this.config.tags.map((tag) => {
      const live = this.liveTag(tag); const result = this._results.get(Number(tag.id)); const color = pwColor(live?.color); const selected = Number(tag.id) === Number(this._activeTagId);
      return `<button class="tag ${selected ? "selected" : ""}" data-tag="${Number(tag.id)}" style="--tag-color:${color}"><span class="tag-name">${pwEscape(live?.name || tag.name)}</span><span class="tag-meta"><strong>${result?.count ?? "—"}</strong> ${pwDocumentLabel(result?.count)}</span>${result?.aggregate ? `<span class="tag-sum">${pwEscape(this.aggregateText(result))}</span>` : ""}</button>`;
    }).join("");
    this.shadowRoot.innerHTML = `<style>${pwGlassStyle}.body{padding:18px}.label{padding:0 4px 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.68}.tag{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;width:100%;margin:0 0 10px;padding:14px 15px;border:1.25px solid var(--tag-color);border-radius:19px;background:linear-gradient(135deg,rgba(255,255,255,.10),color-mix(in srgb,var(--tag-color) 8%,transparent));color:#fff;text-align:left;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.32);transition:.16s ease}.tag:last-child{margin-bottom:0}.tag:hover{transform:translateY(-1px);background:linear-gradient(135deg,rgba(255,255,255,.15),color-mix(in srgb,var(--tag-color) 13%,transparent))}.tag.selected{border-width:2.5px;box-shadow:inset 4px 0 0 var(--tag-color),0 8px 25px color-mix(in srgb,var(--tag-color) 24%,transparent)}.tag-name{grid-column:1;grid-row:1;display:block;min-width:0;font-size:16px;font-weight:700}.tag-meta{grid-column:1 / -1;grid-row:2;display:block;margin-top:5px;font-size:12px;opacity:.82}.tag-sum{grid-column:2;grid-row:1;display:block;margin-left:12px;font-size:14px;font-weight:650;opacity:1;text-align:right;white-space:nowrap}.setup,.error{padding:16px 4px;color:rgba(255,255,255,.84)}.error{color:#ffb4ab}</style><ha-card><div class="body"><div class="label">Dokumenten-Workflows</div>${this._error ? `<div class="error">${pwEscape(this._error)}</div>` : !this._instance ? '<div class="setup">Bitte eine Paperless-Instanz auswählen.</div>' : !buttons ? '<div class="setup">Bitte Tags im Karteneditor hinzufügen.</div>' : buttons}</div></ha-card>`;
    this.shadowRoot.querySelectorAll("[data-tag]").forEach((button) => button.addEventListener("click", () => this.chooseTag(button.dataset.tag)));
  }
}

class PaperlessWorkflowCardEditor extends PaperlessEditorBase {
  setConfig(config) {
    this.config = { workflow_id: "paperless-main", tags: [], ...config, tags: Array.isArray(config.tags) ? config.tags.map((tag) => ({ ...tag })) : [] };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.loadInstances(); this.render();
  }

  move(from, to) {
    if (to < 0 || to >= this.config.tags.length || from === to) return;
    const tags = [...this.config.tags]; const [item] = tags.splice(from, 1); tags.splice(to, 0, item); this.update((config) => { config.tags = tags; });
  }

  render() {
    if (!this.shadowRoot || !this.config) return;
    const chosen = new Set(this.config.tags.map((tag) => Number(tag.id)));
    const available = (this.instance?.tags || []).filter((tag) => !chosen.has(Number(tag.id)));
    const monetary = (this.instance?.custom_fields || []).filter((field) => field.data_type === "monetary");
    const rows = this.config.tags.map((tag, index) => {
      const live = this.instance?.tags.find((item) => Number(item.id) === Number(tag.id));
      return `<div class="row draggable" draggable="true" data-index="${index}"><span class="handle">⋮⋮</span><span class="grow"><strong>${pwEscape(live?.name || tag.name)}</strong><small>Summenfeld</small><select data-action="tag-sum" data-index="${index}"><option value="">Keine Summe</option>${monetary.map((field) => `<option value="${field.id}" ${Number(tag.sum_field_id) === Number(field.id) ? "selected" : ""}>${pwEscape(field.name)}</option>`).join("")}</select></span><span class="buttons"><button data-action="up" data-index="${index}">↑</button><button data-action="down" data-index="${index}">↓</button><button data-action="remove" data-index="${index}">×</button></span></div>`;
    }).join("");
    const defaults = this.config.tags.map((tag) => `<option value="${tag.id}" ${Number(this.config.default_tag_id) === Number(tag.id) ? "selected" : ""}>${pwEscape(tag.name)}</option>`).join("");
    this.shadowRoot.innerHTML = `<style>${pwEditorStyle}</style><div class="editor"><div class="section"><h3>Dokumenten-Workflows</h3><div class="grid"><label>Paperless-Instanz<select data-action="instance"><option value="">Bitte auswählen</option>${this.instanceOptions()}</select></label><label>Workflow-ID<input data-action="workflow-id" value="${pwEscape(this.config.workflow_id)}"></label></div><p class="hint">Die Workflow-ID verbindet diese Karte mit einer Workflow-Details-Karte.</p></div><div class="section"><h3>Tags</h3><div class="add"><select data-add="tag"><option value="">Tag auswählen …</option>${available.map((tag) => `<option value="${tag.id}">${pwEscape(tag.name)}</option>`).join("")}</select><button data-action="add">Hinzufügen</button></div>${rows || '<p class="hint">Noch keine Tags ausgewählt.</p>'}<label style="margin-top:12px">Beim Öffnen ausgewählter Tag<select data-action="default-tag"><option value="">Erster Tag</option>${defaults}</select></label><p class="hint">Tags können mit dem Griff oder den Pfeilen verschoben werden. Die Farbe wird live aus Paperless übernommen.</p></div></div>`;
    const root = this.shadowRoot;
    root.querySelector('[data-action="instance"]').addEventListener("change", (event) => this.update((config) => { config.instance_id = event.target.value; config.tags = []; config.default_tag_id = null; }));
    root.querySelector('[data-action="workflow-id"]').addEventListener("input", (event) => { this.config.workflow_id = event.target.value; this.changed(); });
    root.querySelector('[data-action="default-tag"]').addEventListener("change", (event) => this.update((config) => { config.default_tag_id = event.target.value ? Number(event.target.value) : null; }));
    root.querySelectorAll('[data-action="tag-sum"]').forEach((select) => select.addEventListener("change", (event) => this.update((config) => { config.tags[Number(event.target.dataset.index)].sum_field_id = event.target.value ? Number(event.target.value) : null; })));
    root.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action; const index = Number(button.dataset.index);
      if (action === "add") { const id = Number(root.querySelector('[data-add="tag"]').value); const tag = this.instance?.tags.find((item) => Number(item.id) === id); if (tag) this.update((config) => { config.tags.push({ id, name: tag.name, sum_field_id: null }); if (!config.default_tag_id) config.default_tag_id = id; }); }
      else if (action === "remove") this.update((config) => { config.tags.splice(index, 1); if (!config.tags.some((tag) => Number(tag.id) === Number(config.default_tag_id))) config.default_tag_id = config.tags[0]?.id || null; });
      else if (action === "up") this.move(index, index - 1); else if (action === "down") this.move(index, index + 1);
    }));
    let dragged = null;
    root.querySelectorAll(".draggable").forEach((row) => { row.addEventListener("dragstart", () => { dragged = Number(row.dataset.index); row.classList.add("dragging"); }); row.addEventListener("dragend", () => row.classList.remove("dragging")); row.addEventListener("dragover", (event) => event.preventDefault()); row.addEventListener("drop", (event) => { event.preventDefault(); this.move(dragged, Number(row.dataset.index)); dragged = null; }); });
  }
}

class PaperlessWorkflowDetailsCard extends PaperlessCardBase {
  static getStubConfig() { return { workflow_id: "paperless-main", columns: PW_DEFAULTS.columns.map((item) => ({ ...item })), max_documents: 50, ordering: "created", default_direction: "asc" }; }
  static async getConfigElement() { return document.createElement("paperless-workflow-details-card-editor"); }

  setConfig(config) {
    this.config = pwNormalizeConfig({ workflow_id: "paperless-main", ...config });
    this._activeTag = PW_WORKFLOW_STATE.get(this.config.workflow_id)?.tag || null;
    this._sortKey = this.config.default_sort || null; this._sortDirection = this.config.default_direction || "asc";
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.render(); this.loadInstances();
  }

  connectedCallback() {
    this._selectionHandler = (event) => {
      if (event.detail?.workflow_id !== this.config?.workflow_id) return;
      if (this.config.instance_id && event.detail.entry_id !== this.config.instance_id) return;
      this._activeTag = event.detail.tag;
      this._result = null;
      this._sortKey = this.config.default_sort || null;
      this._sortDirection = this.config.default_direction || "asc";
      if (this._refreshing) { this._refreshPending = true; this.render(); }
      else this.refresh();
    };
    window.addEventListener(PW_WORKFLOW_EVENT, this._selectionHandler);
  }

  disconnectedCallback() { if (this._selectionHandler) window.removeEventListener(PW_WORKFLOW_EVENT, this._selectionHandler); }
  instancesLoaded() {
    const shared = PW_WORKFLOW_STATE.get(this.config.workflow_id);
    if (shared && (!this.config.instance_id || shared.entry_id === this.config.instance_id)) this._activeTag = shared.tag;
    if (!this._activeTag && this.config.default_tag_id) this._activeTag = this._instance?.tags.find((tag) => Number(tag.id) === Number(this.config.default_tag_id));
    this.refresh();
  }
  getCardSize() { return 7; }
  getLayoutOptions() { return { grid_columns: "full", grid_rows: 7 }; }

  fieldDefinition(key) {
    if (!this._instance) return null;
    if (key.startsWith("standard:")) { const raw = key.split(":", 2)[1]; return this._instance.document_fields.find((field) => field.key === raw) || null; }
    const id = Number(key.split(":", 2)[1]); const field = this._instance.custom_fields.find((item) => Number(item.id) === id); return field ? { ...field, key, custom: true } : null;
  }
  rawValue(document, key) { if (key.startsWith("standard:")) return document[key.split(":", 2)[1]]; const field = this.fieldDefinition(key); return field ? document.custom_fields?.[field.name] : null; }
  dateValue(value) { if (!value) return null; const text = String(value).trim(); const iso = /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0]; if (iso) return iso; const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text); if (german) return `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`; const timestamp = Date.parse(text); return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10); }
  numberValue(value) { if (typeof value === "number") return value; const parsed = Number.parseFloat(String(value ?? "").replace(/[A-Z€$£\s]/gi, "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : null; }
  formatMoney(value, currency = this._instance?.default_currency || "EUR") { const number = this.numberValue(value); return number === null ? "—" : `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} ${currency}`; }
  formatValue(document, column) { const definition = this.fieldDefinition(column.key); const value = this.rawValue(document, column.key); if (value === null || value === undefined || value === "") return "—"; if (definition?.data_type === "date" || ["created", "added", "modified"].includes(definition?.key)) { const iso = this.dateValue(value); if (!iso) return String(value); const [year, month, day] = iso.split("-"); return `${day}.${month}.${year}`; } if (definition?.data_type === "monetary") return this.formatMoney(value); if (Array.isArray(value)) return value.join(", "); if (typeof value === "object") return JSON.stringify(value); return String(value); }
  aggregateText(result) { return Object.entries(result?.aggregate?.totals || {}).map(([currency, value]) => this.formatMoney(value, currency)).join(" · "); }
  compareDocuments(left, right) { if (!this._sortKey) return 0; const definition = this.fieldDefinition(this._sortKey); let a = this.rawValue(left, this._sortKey); let b = this.rawValue(right, this._sortKey); if (definition?.data_type === "date" || ["created", "added", "modified"].includes(definition?.key)) { a = this.dateValue(a); b = this.dateValue(b); } else if (["monetary", "integer", "float"].includes(definition?.data_type)) { a = this.numberValue(a); b = this.numberValue(b); } if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "" ? 0 : 1; if (b === null || b === undefined || b === "") return -1; const result = typeof a === "number" ? a - b : String(a).localeCompare(String(b), "de-DE", { numeric: true, sensitivity: "base" }); return this._sortDirection === "desc" ? -result : result; }
  chooseSort(key) { if (this._sortKey === key) this._sortDirection = this._sortDirection === "asc" ? "desc" : "asc"; else { this._sortKey = key; this._sortDirection = "asc"; } this.render(); }

  async refresh() {
    if (!this._hass || !this._instance || !this._activeTag || this._refreshing) { this.render(); return; }
    this._refreshing = true; this.render();
    try {
      const message = { type: "paperless_workflows/tag_workspace", entry_id: this._instance.entry_id, tag_id: Number(this._activeTag.id), columns: this.config.columns.map((column) => column.key), ordering: this.config.ordering || "created", max_documents: Number(this.config.max_documents || 50) };
      if (this._activeTag.sum_field_id !== undefined && this._activeTag.sum_field_id !== null && this._activeTag.sum_field_id !== "") message.sum_field_id = Number(this._activeTag.sum_field_id);
      this._result = await this._hass.callWS(message); this._error = null;
    } catch (error) { this._error = error?.message || String(error); }
    finally {
      this._refreshing = false;
      const refreshPending = this._refreshPending;
      this._refreshPending = false;
      this.render();
      if (refreshPending) this.refresh();
    }
  }

  render() {
    if (!this.shadowRoot || !this.config) return;
    const accent = pwColor(this._activeTag?.color); const documents = [...(this._result?.documents || [])].sort((a, b) => this.compareDocuments(a, b));
    const headers = this.config.columns.map((column) => { const active = this._sortKey === column.key; const arrow = active ? (this._sortDirection === "asc" ? "▲" : "▼") : ""; const justify = column.align === "right" ? "flex-end" : column.align === "center" ? "center" : "flex-start"; return `<th style="text-align:${column.align || "left"}"><button data-sort="${pwEscape(column.key)}" style="justify-content:${justify}">${pwEscape(column.label || this.fieldDefinition(column.key)?.name || column.key)} <span>${arrow}</span></button></th>`; }).join("");
    const rows = documents.map((document) => `<tr>${this.config.columns.map((column) => { const value = pwEscape(this.formatValue(document, column)); const weight = column.text_style === "bold" ? 700 : 400; const style = column.text_style === "italic" ? "italic" : "normal"; const content = column.key === "standard:title" ? `<a href="${pwEscape(document.url || "#")}" target="_blank" rel="noopener noreferrer">${value}</a>` : value; return `<td style="font-size:${Number(column.font_size || 14)}px;font-weight:${weight};font-style:${style};text-align:${column.align || "left"}">${content}</td>`; }).join("")}</tr>`).join("");
    this.shadowRoot.innerHTML = `<style>${pwGlassStyle}:host{--accent:${accent}}.details{min-width:0;padding:18px 22px 24px}.head{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:baseline;gap:18px;padding:4px 2px 15px;border-bottom:1px solid color-mix(in srgb,var(--accent) 70%,white)}.title{font-size:20px;font-weight:750}.total{text-align:right;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}.loading{font-size:12px;opacity:.72}.error,.empty,.setup{margin:22px 2px;color:rgba(255,255,255,.84)}.error{color:#ffb4ab}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;table-layout:auto}thead tr,tbody tr{border-bottom:1px solid rgba(255,255,255,.21)}tbody tr:last-child{border-bottom:0}th{padding:11px 8px;background:rgba(255,255,255,.03)}th button{appearance:none;display:flex;align-items:center;gap:5px;width:100%;padding:0;border:0;background:transparent;color:#fff;font:650 13px/1.2 inherit;cursor:pointer}th button:hover{color:var(--accent)}td{padding:13px 8px;color:rgba(255,255,255,.94);vertical-align:middle;overflow-wrap:anywhere}td a{color:#fff;text-decoration:none}td a:hover{text-decoration:underline}@media(max-width:800px){.details{padding:16px 14px 22px}.table-wrap table{min-width:720px}}</style><ha-card><main class="details">${this._error ? `<div class="error">${pwEscape(this._error)}</div>` : !this._instance ? '<div class="setup">Bitte eine Paperless-Instanz auswählen.</div>' : !this._activeTag ? '<div class="setup">Bitte einen Workflow in der verbundenen Workflow-Karte auswählen.</div>' : `<div class="head"><div class="title">${pwEscape(this._activeTag.name || "Dokumente")} · ${this._result?.count ?? "—"} ${pwDocumentLabel(this._result?.count)} ${this._refreshing ? '<span class="loading">Wird aktualisiert …</span>' : ""}</div><div class="total">${pwEscape(this.aggregateText(this._result))}</div></div>${documents.length ? `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${this._refreshing ? "Dokumente werden geladen …" : "Keine Dokumente vorhanden."}</div>`}`}</main></ha-card>`;
    this.shadowRoot.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => this.chooseSort(button.dataset.sort)));
  }
}

class PaperlessWorkflowDetailsCardEditor extends PaperlessEditorBase {
  setConfig(config) {
    this.config = pwNormalizeConfig({ workflow_id: "paperless-main", ...config });
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.loadInstances(); this.render();
  }
  fieldOptions() { if (!this.instance) return []; return [...this.instance.document_fields.map((field) => ({ ...field, optionKey: `standard:${field.key}` })), ...this.instance.custom_fields.map((field) => ({ ...field, optionKey: `custom:${field.id}` }))]; }
  defaultColumn(field) { const monetary = field.data_type === "monetary"; const title = field.optionKey === "standard:title"; return { key: field.optionKey, label: field.name, font_size: title ? 18 : monetary ? 16 : 14, text_style: title || monetary ? "bold" : "normal", align: monetary ? "right" : "left" }; }
  move(from, to) { if (to < 0 || to >= this.config.columns.length || from === to) return; const columns = [...this.config.columns]; const [item] = columns.splice(from, 1); columns.splice(to, 0, item); this.update((config) => { config.columns = columns; }); }
  render() {
    if (!this.shadowRoot || !this.config) return;
    const fields = this.fieldOptions(); const chosen = new Set(this.config.columns.map((column) => column.key)); const available = fields.filter((field) => !chosen.has(field.optionKey));
    const columns = this.config.columns.map((column, index) => `<div class="row draggable column" draggable="true" data-index="${index}"><span class="handle">⋮⋮</span><div class="column-fields"><label>Spalte<input data-action="label" data-index="${index}" value="${pwEscape(column.label)}"></label><label>Größe (px)<input type="number" min="10" max="40" data-action="size" data-index="${index}" value="${Number(column.font_size || 14)}"></label><label>Schrift<select data-action="style" data-index="${index}"><option value="normal" ${column.text_style === "normal" ? "selected" : ""}>Normal</option><option value="bold" ${column.text_style === "bold" ? "selected" : ""}>Fett</option><option value="italic" ${column.text_style === "italic" ? "selected" : ""}>Kursiv</option></select></label><label>Ausrichtung<select data-action="align" data-index="${index}"><option value="left" ${column.align === "left" ? "selected" : ""}>Links</option><option value="center" ${column.align === "center" ? "selected" : ""}>Zentriert</option><option value="right" ${column.align === "right" ? "selected" : ""}>Rechts</option></select></label></div><span class="buttons"><button data-action="up" data-index="${index}">↑</button><button data-action="down" data-index="${index}">↓</button><button data-action="remove" data-index="${index}">×</button></span></div>`).join("");
    const tagOptions = (this.instance?.tags || []).map((tag) => `<option value="${tag.id}" ${Number(this.config.default_tag_id) === Number(tag.id) ? "selected" : ""}>${pwEscape(tag.name)}</option>`).join("");
    this.shadowRoot.innerHTML = `<style>${pwEditorStyle}</style><div class="editor"><div class="section"><h3>Workflow-Details</h3><div class="grid"><label>Paperless-Instanz<select data-action="instance"><option value="">Bitte auswählen</option>${this.instanceOptions()}</select></label><label>Workflow-ID<input data-action="workflow-id" value="${pwEscape(this.config.workflow_id)}"></label><label>Start-Tag / Vorschau<select data-action="default-tag"><option value="">Aus Workflow übernehmen</option>${tagOptions}</select></label><label>Maximale Dokumente<input type="number" min="1" max="100" data-action="max" value="${Number(this.config.max_documents || 50)}"></label></div><p class="hint">Die Workflow-ID muss mit der Workflow-Karte übereinstimmen. Im Dashboard folgt diese Karte automatisch dem dort ausgewählten Tag.</p></div><div class="section"><h3>Dokumentenspalten</h3><div class="add"><select data-add="column"><option value="">Feld auswählen …</option>${available.map((field) => `<option value="${pwEscape(field.optionKey)}">${pwEscape(field.name)}${field.optionKey.startsWith("custom:") ? " · Custom Field" : ""}</option>`).join("")}</select><button data-action="add">Hinzufügen</button></div>${columns || '<p class="hint">Noch keine Spalten ausgewählt.</p>'}<div class="grid" style="margin-top:12px"><label>API-Sortierung<select data-action="ordering"><option value="created" ${this.config.ordering === "created" ? "selected" : ""}>Erstellt · aufsteigend</option><option value="-created" ${this.config.ordering === "-created" ? "selected" : ""}>Erstellt · absteigend</option><option value="title" ${this.config.ordering === "title" ? "selected" : ""}>Titel · A–Z</option><option value="-modified" ${this.config.ordering === "-modified" ? "selected" : ""}>Zuletzt geändert</option></select></label></div></div></div>`;
    const root = this.shadowRoot;
    root.querySelector('[data-action="instance"]').addEventListener("change", (event) => this.update((config) => { config.instance_id = event.target.value; config.columns = PW_DEFAULTS.columns.map((column) => ({ ...column })); config.default_tag_id = null; }));
    root.querySelector('[data-action="workflow-id"]').addEventListener("input", (event) => { this.config.workflow_id = event.target.value; this.changed(); });
    root.querySelector('[data-action="default-tag"]').addEventListener("change", (event) => this.update((config) => { config.default_tag_id = event.target.value ? Number(event.target.value) : null; }));
    root.querySelector('[data-action="max"]').addEventListener("input", (event) => { this.config.max_documents = Math.max(1, Math.min(100, Number(event.target.value) || 50)); this.changed(); });
    root.querySelector('[data-action="ordering"]').addEventListener("change", (event) => this.update((config) => { config.ordering = event.target.value; }));
    root.querySelectorAll('[data-action="label"],[data-action="size"]').forEach((input) => input.addEventListener("input", (event) => { const index = Number(event.target.dataset.index); if (event.target.dataset.action === "label") this.config.columns[index].label = event.target.value; else this.config.columns[index].font_size = Math.max(10, Math.min(40, Number(event.target.value) || 14)); this.changed(); }));
    root.querySelectorAll('[data-action="style"],[data-action="align"]').forEach((select) => select.addEventListener("change", (event) => this.update((config) => { config.columns[Number(event.target.dataset.index)][event.target.dataset.action === "style" ? "text_style" : "align"] = event.target.value; })));
    root.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", () => { const action = button.dataset.action; const index = Number(button.dataset.index); if (action === "add") { const key = root.querySelector('[data-add="column"]').value; const field = fields.find((item) => item.optionKey === key); if (field) this.update((config) => { config.columns.push(this.defaultColumn(field)); }); } else if (action === "remove") this.update((config) => { config.columns.splice(index, 1); }); else if (action === "up") this.move(index, index - 1); else if (action === "down") this.move(index, index + 1); }));
    let dragged = null; root.querySelectorAll(".draggable").forEach((row) => { row.addEventListener("dragstart", () => { dragged = Number(row.dataset.index); row.classList.add("dragging"); }); row.addEventListener("dragend", () => row.classList.remove("dragging")); row.addEventListener("dragover", (event) => event.preventDefault()); row.addEventListener("drop", (event) => { event.preventDefault(); this.move(dragged, Number(row.dataset.index)); dragged = null; }); });
  }
}

if (!customElements.get("paperless-workspace-card")) customElements.define("paperless-workspace-card", PaperlessWorkspaceCard);
if (!customElements.get("paperless-workspace-card-editor")) customElements.define("paperless-workspace-card-editor", PaperlessWorkspaceCardEditor);
if (!customElements.get("paperless-header-card")) customElements.define("paperless-header-card", PaperlessHeaderCard);
if (!customElements.get("paperless-header-card-editor")) customElements.define("paperless-header-card-editor", PaperlessHeaderCardEditor);
if (!customElements.get("paperless-workflow-card")) customElements.define("paperless-workflow-card", PaperlessWorkflowCard);
if (!customElements.get("paperless-workflow-card-editor")) customElements.define("paperless-workflow-card-editor", PaperlessWorkflowCardEditor);
if (!customElements.get("paperless-workflow-details-card")) customElements.define("paperless-workflow-details-card", PaperlessWorkflowDetailsCard);
if (!customElements.get("paperless-workflow-details-card-editor")) customElements.define("paperless-workflow-details-card-editor", PaperlessWorkflowDetailsCardEditor);
window.customCards = window.customCards || [];
window.customCards.push(
  { type: "paperless-header-card", name: "Paperless · Header", description: "Titel, Beschreibung und automatisch ermittelter DNS-Name.", preview: true },
  { type: "paperless-workflow-card", name: "Paperless · Workflows", description: "Konfigurierbare Tag-Liste mit Zähler und optionaler Summe.", preview: true },
  { type: "paperless-workflow-details-card", name: "Paperless · Workflow-Details", description: "Dynamische Dokumententabelle zum ausgewählten Workflow.", preview: true },
);
