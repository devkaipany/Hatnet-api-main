import React, { useState, useEffect, useCallback } from "react";
import "./App.css";

// ─── Config: danh sách tenant đồng bộ với tenants.json ─────────────────────
// Khi thêm tenant mới vào tenants.json, thêm entry tương ứng vào đây.
const TENANTS = [
  { id: "kaipany", label: "Kaipany", routePrefix: "Kaipany" },
  { id: "nsbb",    label: "NSBB",    routePrefix: "NSBB" },
];

// Production (Vercel): cùng domain → gọi relative URL ""
// Development (local): React port 3000, API port 3001
const API_BASE = process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");


// ─── Helpers ─────────────────────────────────────────────────────────────────
function toMs(datetimeLocalStr) {
  return datetimeLocalStr ? new Date(datetimeLocalStr).getTime() : null;
}

function fmtDateTime(ms) {
  if (!ms) return "N/A";
  return new Date(parseInt(ms)).toLocaleString("vi-VN");
}

// ─── Sub-component: CopyButton ────────────────────────────────────────────────
function CopyButton({ text, className = "json-copy-btn" }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className={`${className} ${copied ? "copied" : ""}`} onClick={handle} type="button">
      {copied ? "✓ Đã sao chép" : "Sao chép"}
    </button>
  );
}

// ─── Sub-component: Alert ─────────────────────────────────────────────────────
function Alert({ type = "error", children }) {
  const icons = { error: "⚠️", success: "✅", info: "ℹ️" };
  return (
    <div className={`alert alert-${type}`}>
      <span className="alert-icon">{icons[type]}</span>
      <span>{children}</span>
    </div>
  );
}

// ─── Tab 1: Tenant Checkin Query ──────────────────────────────────────────────
function TenantQueryTab() {
  const [activeTenant, setActiveTenant] = useState(TENANTS[0]);
  const [places, setPlaces] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [placeErr, setPlaceErr] = useState(null);
  const [deviceErr, setDeviceErr] = useState(null);
  const [form, setForm] = useState({ placeId: "", deviceId: "", from: "", to: "" });
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [queryErr, setQueryErr] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // URL preview — cập nhật realtime theo form
  const previewUrl = React.useMemo(() => {
    if (!form.placeId) return null;
    const dateFrom = toMs(form.from) ?? (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
    const dateTo   = toMs(form.to)   ?? Date.now();
    const params = new URLSearchParams({ placeId: form.placeId, dateFrom, dateTo });
    if (form.deviceId) params.append("deviceId", form.deviceId);
    return `${API_BASE}/${activeTenant.routePrefix}/checkins?${params}`;
  }, [form, activeTenant]);

  // Fetch places khi đổi tenant
  const fetchPlaces = useCallback(async () => {
    setLoadingPlaces(true);
    setPlaceErr(null);
    setPlaces([]);
    setDevices([]);
    setForm({ placeId: "", deviceId: "", from: "", to: "" });
    setResults(null);
    try {
      const res = await fetch(`${API_BASE}/${activeTenant.routePrefix}/place`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Lỗi ${res.status}`);
      if (data.success && Array.isArray(data.data)) {
        setPlaces(data.data);
      } else {
        throw new Error("Dữ liệu không hợp lệ");
      }
    } catch (e) {
      setPlaceErr(e.message);
    } finally {
      setLoadingPlaces(false);
    }
  }, [activeTenant]);

  useEffect(() => {
    fetchPlaces();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant]);  // activeTenant thay đổi → fetch lại, luôn dùng đúng tenant

  // Fetch devices khi đổi place
  useEffect(() => {
    if (!form.placeId) { setDevices([]); return; }
    const load = async () => {
      setLoadingDevices(true);
      setDeviceErr(null);
      try {
        const res = await fetch(`${API_BASE}/${activeTenant.routePrefix}/device?placeId=${form.placeId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `Lỗi ${res.status}`);
        if (data.success && Array.isArray(data.data)) {
          setDevices(data.data);
        } else throw new Error("Dữ liệu thiết bị không hợp lệ");
      } catch (e) {
        setDeviceErr(e.message);
      } finally {
        setLoadingDevices(false);
      }
    };
    load();
  }, [form.placeId, activeTenant]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setQueryErr(null);
    setSuccessMsg(null);
    setResults(null);

    try {
      const dateFrom = toMs(form.from) ?? (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
      const dateTo   = toMs(form.to)   ?? Date.now();
      if (dateFrom > dateTo) throw new Error("Thời gian bắt đầu không được lớn hơn thời gian kết thúc.");

      const params = new URLSearchParams({ placeId: form.placeId, dateFrom, dateTo });
      if (form.deviceId) params.append("devices", form.deviceId);

      const url = `${API_BASE}/${activeTenant.routePrefix}/checkins?${params}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Lỗi ${res.status}`);
      if (Array.isArray(data)) {
        setResults(data);
        setSuccessMsg(`Tìm thấy ${data.length} kết quả.`);
      } else {
        setResults([]);
        setSuccessMsg(data.message || "Không tìm thấy kết quả nào.");
      }
    } catch (e) {
      setQueryErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Truy vấn Check-in</div>
        <div className="section-subtitle">Xem dữ liệu điểm danh theo địa điểm và khoảng thời gian</div>
      </div>

      {/* Tenant Tab Bar */}
      <div className="tenant-tab-bar">
        {TENANTS.map((t) => (
          <button
            key={t.id}
            className={`tenant-tab ${activeTenant.id === t.id ? "active" : ""}`}
            onClick={() => setActiveTenant(t)}
            type="button"
          >
            <span className="tenant-dot" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Query Form */}
      <div className="card">
        <div className="card-title">
          <span className="title-icon">🔍</span>
          Bộ lọc — {activeTenant.label}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            {/* Địa điểm */}
            <div className="form-group">
              <label className="form-label required">Địa điểm</label>
              <select
                className="form-select"
                value={form.placeId}
                disabled={loadingPlaces}
                required
                onChange={(e) =>
                  setForm((f) => ({ ...f, placeId: e.target.value, deviceId: "" }))
                }
              >
                <option value="">
                  {loadingPlaces ? "Đang tải…" : "-- Chọn địa điểm --"}
                </option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (ID: {p.id})
                  </option>
                ))}
              </select>
              {placeErr && <Alert type="error">{placeErr}</Alert>}
            </div>

            {/* Thiết bị */}
            <div className="form-group">
              <label className="form-label">Thiết bị (tùy chọn)</label>
              <select
                className="form-select"
                value={form.deviceId}
                disabled={!form.placeId || loadingDevices}
                onChange={(e) => setForm((f) => ({ ...f, deviceId: e.target.value }))}
              >
                <option value="">
                  {!form.placeId
                    ? "-- Chọn địa điểm trước --"
                    : loadingDevices
                    ? "Đang tải…"
                    : "-- Tất cả thiết bị --"}
                </option>
                {devices.map((d) => (
                  <option key={d.deviceID} value={d.deviceID}>
                    {d.deviceName} ({d.deviceID})
                  </option>
                ))}
              </select>
              {deviceErr && <Alert type="error">{deviceErr}</Alert>}
            </div>

            {/* Từ */}
            <div className="form-group">
              <label className="form-label required">Từ ngày</label>
              <input
                type="datetime-local"
                className="form-input"
                value={form.from}
                onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              />
            </div>

            {/* Đến */}
            <div className="form-group">
              <label className="form-label required">Đến ngày</label>
              <input
                type="datetime-local"
                className="form-input"
                value={form.to}
                onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
          </div>

          {/* URL Preview */}
          {previewUrl && (
            <div className="url-preview-wrap">
              <span className="url-preview-label">🔗 Thông tin truy vấn:</span>
              <div className="url-preview-row">
                <input
                  readOnly
                  className="url-preview-input"
                  value={previewUrl}
                  onClick={(e) => e.target.select()}
                />
                <CopyButton text={previewUrl} className="url-copy-btn" />
              </div>
            </div>
          )}

          {queryErr && <div style={{ marginTop: "1rem" }}><Alert type="error">{queryErr}</Alert></div>}

          <div style={{ marginTop: "1.25rem" }}>
            <button
              type="submit"
              className="btn btn-primary btn-full btn-lg"
              disabled={submitting || !form.placeId}
            >
              {submitting ? (
                <><span className="btn-spinner" /> Đang truy vấn…</>
              ) : (
                <>🔍 Tìm kiếm Check-in</>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      {results !== null && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <div className="results-header">
            <div className="card-title" style={{ marginBottom: 0 }}>
              <span className="title-icon">📋</span>
              Kết quả
            </div>
            <span className="results-count">
              {results.length} bản ghi
            </span>
          </div>

          {successMsg && (
            <div style={{ marginBottom: "1rem" }}>
              <Alert type={results.length > 0 ? "success" : "info"}>{successMsg}</Alert>
            </div>
          )}

          {results.length > 0 ? (
            <>
              <div className="table-wrapper">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Họ tên</th>
                      <th>Person ID</th>
                      <th>Alias ID</th>
                      <th>Chức vụ</th>
                      <th>Ngày</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={`${r.personID}_${i}`}>
                        <td className="td-mono" style={{ color: "var(--text-faint)" }}>{i + 1}</td>
                        <td className="td-name">{r.personName || "(Không tên)"}</td>
                        <td className="td-mono">{r.personID}</td>
                        <td className="td-mono">{r.aliasID || "—"}</td>
                        <td><span className="td-badge">{r.title || "Khách"}</span></td>
                        <td className="td-time">{r.date || "—"}</td>
                        <td className="td-time">{r.formattedCheckinTime || fmtDateTime(r.checkinTime)}</td>
                        <td className="td-time">{r.formattedCheckoutTime || fmtDateTime(r.checkoutTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* JSON Block */}
              <div className="json-block" style={{ marginTop: "1.25rem" }}>
                <div className="json-bar">
                  <span className="json-lang">JSON</span>
                  <CopyButton text={JSON.stringify(results, null, 2)} />
                </div>
                <textarea
                  readOnly
                  className="json-textarea"
                  rows={12}
                  value={JSON.stringify(results, null, 2)}
                />
              </div>
            </>
          ) : (
            <div className="no-results">
              <div className="no-results-icon">📭</div>
              <p>Không có dữ liệu trong khoảng thời gian này.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Add API ────────────────────────────────────────────────────────────
function AddApiTab() {
  const defaultApiBase = "https://partner.hanet.ai";
  const defaultTokenUrl = "https://oauth.hanet.com/token";

  const [form, setForm] = useState({
    label: "",
    routePrefix: "",
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    apiBaseUrl: defaultApiBase,
    tokenUrl: defaultTokenUrl,
  });
  const [generated, setGenerated] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({
      ...f,
      [name]: value,
      // Auto-generate routePrefix từ label (PascalCase, no space)
      ...(name === "label"
        ? { routePrefix: value.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "") }
        : {}),
    }));
  };

  const handleGenerate = (e) => {
    e.preventDefault();
    const tenantId = form.routePrefix.toLowerCase();

    // JSON với credentials thật — paste thẳng vào tenants.json
    const jsonBlock = {
      id: tenantId,
      routePrefix: form.routePrefix,
      active: true,
      hanetApiBaseUrl: form.apiBaseUrl,
      tokenUrl: form.tokenUrl,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
      refreshToken: form.refreshToken,
    };

    const tenantJsBlock = `  { id: "${tenantId}", label: "${form.label}", routePrefix: "${form.routePrefix}" },`;

    setGenerated({ jsonBlock, tenantJsBlock });
  };

  const valid =
    form.label && form.clientId && form.clientSecret && form.refreshToken;

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Thêm tài khoản Hanet API</div>
        <div className="section-subtitle">
          Điền thông tin credentials để tạo cấu hình cho tenant mới
        </div>
      </div>

      <div className="add-api-layout">
        {/* Form */}
        <div className="card">
          <div className="card-title">
            <span className="title-icon">🔑</span>
            Thông tin credentials
          </div>
          <form onSubmit={handleGenerate}>
            <div className="form-grid">
              <div className="form-group full">
                <label className="form-label required">Tên hiển thị</label>
                <input
                  className="form-input"
                  name="label"
                  value={form.label}
                  onChange={handleChange}
                  placeholder="VD: GymBrand"
                  required
                />
                {form.routePrefix && (
                  <span className="form-hint">
                    🔗 Route tự động: <code style={{color:"var(--accent)",background:"var(--surface-3)",padding:"1px 5px",borderRadius:4}}>/{form.routePrefix}/checkins</code>
                  </span>
                )}
              </div>

              <div className="form-group full">
                <label className="form-label required">Client ID</label>
                <input
                  className="form-input"
                  name="clientId"
                  value={form.clientId}
                  onChange={handleChange}
                  placeholder="Hanet Client ID"
                  required
                />
              </div>

              <div className="form-group full">
                <label className="form-label required">Client Secret</label>
                <input
                  className="form-input"
                  name="clientSecret"
                  value={form.clientSecret}
                  onChange={handleChange}
                  placeholder="Hanet Client Secret"
                  type="password"
                  required
                />
              </div>

              <div className="form-group full">
                <label className="form-label required">Refresh Token</label>
                <input
                  className="form-input"
                  name="refreshToken"
                  value={form.refreshToken}
                  onChange={handleChange}
                  placeholder="Hanet Refresh Token"
                  type="password"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">API Base URL</label>
                <input
                  className="form-input"
                  name="apiBaseUrl"
                  value={form.apiBaseUrl}
                  onChange={handleChange}
                  placeholder={defaultApiBase}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Token URL</label>
                <input
                  className="form-input"
                  name="tokenUrl"
                  value={form.tokenUrl}
                  onChange={handleChange}
                  placeholder={defaultTokenUrl}
                />
              </div>
            </div>

            <div style={{ marginTop: "1.25rem" }}>
              <button type="submit" className="btn btn-primary btn-full" disabled={!valid}>
                ⚡ Tạo cấu hình
              </button>
            </div>
          </form>
        </div>

        {/* Hướng dẫn */}
        <div>
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="card-title">
              <span className="title-icon">📖</span>
              Hướng dẫn
            </div>
            <div className="steps-guide">
              <div className="step-item">
                <div className="step-num">1</div>
                <div className="step-body">
                  <div className="step-title">Điền & Tạo cấu hình</div>
                  <div className="step-desc">Nhập credentials từ Hanet Developer Portal rồi nhấn "Tạo cấu hình".</div>
                </div>
              </div>
              <div className="step-item">
                <div className="step-num">2</div>
                <div className="step-body">
                  <div className="step-title">Cập nhật code</div>
                  <div className="step-desc">
                    Sao chép JSON block → paste vào <span className="step-code">api/tenants.json</span> (trong mảng "tenants").<br />
                    Thêm 1 dòng vào <span className="step-code">App.js → const TENANTS</span>.
                  </div>
                </div>
              </div>
              <div className="step-item">
                <div className="step-num">3</div>
                <div className="step-body">
                  <div className="step-title">Git push — xong!</div>
                  <div className="step-desc">
                    Chạy <span className="step-code">git add . && git commit -m "add tenant" && git push</span> — Vercel tự deploy. Không cần vào Vercel Dashboard.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Hanet API Docs link */}
          <div className="card">
            <div className="card-title">
              <span className="title-icon">🔗</span>
              Tài liệu Hanet API
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              Lấy credentials từ Hanet Developer Portal:
            </p>
            <a
              href="https://documenter.getpostman.com/view/13088306/TVeqcn2C"
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline btn-sm"
            >
              📄 Xem Hanet API Docs
            </a>
          </div>
        </div>
      </div>

      {/* Generated Config */}
      {generated && (
        <div style={{ marginTop: "1.5rem" }}>
          <div className="card">
            <div className="card-title">
              <span className="title-icon">✅</span>
              Cấu hình đã tạo — chỉ cần 2 bước rồi git push!
            </div>

            {/* Bước 1: tenants.json */}
            <div style={{ marginBottom: "1.5rem" }}>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent)", marginBottom: "0.5rem" }}>
                📁 Bước 1 — Thêm block này vào <code style={{ background: "var(--surface-3)", padding: "2px 6px", borderRadius: 4 }}>api/tenants.json</code> (trong mảng <code style={{ background: "var(--surface-3)", padding: "2px 6px", borderRadius: 4 }}>"tenants"</code>)
              </p>
              <div className="json-block">
                <div className="json-bar">
                  <span className="json-lang">JSON</span>
                  <CopyButton text={JSON.stringify(generated.jsonBlock, null, 2)} />
                </div>
                <textarea
                  readOnly
                  className="json-textarea"
                  rows={10}
                  value={JSON.stringify(generated.jsonBlock, null, 2)}
                />
              </div>
            </div>

            {/* Bước 2: App.js TENANTS */}
            <div style={{ marginBottom: "1.5rem" }}>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent)", marginBottom: "0.5rem" }}>
                ⚛️ Bước 2 — Thêm dòng này vào <code style={{ background: "var(--surface-3)", padding: "2px 6px", borderRadius: 4 }}>client/src/App.js → const TENANTS</code>
              </p>
              <div className="json-block">
                <div className="json-bar">
                  <span className="json-lang">JS</span>
                  <CopyButton text={generated.tenantJsBlock} />
                </div>
                <textarea
                  readOnly
                  className="json-textarea"
                  style={{ color: "#FDE68A" }}
                  rows={3}
                  value={generated.tenantJsBlock}
                />
              </div>
            </div>

            {/* Deploy */}
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent)", marginBottom: "0.5rem" }}>
              🚀 Xong — chạy lệnh này để deploy
            </p>
            <div className="json-block">
              <div className="json-bar">
                <span className="json-lang">BASH</span>
                <CopyButton text={`git add . && git commit -m "feat: add tenant ${form.routePrefix}" && git push`} />
              </div>
              <textarea
                readOnly
                className="json-textarea"
                style={{ color: "#FCA5A5" }}
                rows={2}
                value={`git add . && git commit -m "feat: add tenant ${form.routePrefix}" && git push`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
const App = () => {
  const [mainTab, setMainTab] = useState("query");

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="logo-mark">K</div>
          <span className="logo-text">
            K<span>AI</span>pany
          </span>
        </div>
        <span className="header-badge">Hanet Dashboard</span>
      </header>

      {/* Main Tabs */}
      <nav className="main-tabs">
        <button
          className={`main-tab ${mainTab === "query" ? "active" : ""}`}
          onClick={() => setMainTab("query")}
        >
          <span className="tab-icon">📊</span>
          Xem dữ liệu
        </button>
        <button
          className={`main-tab ${mainTab === "add" ? "active" : ""}`}
          onClick={() => setMainTab("add")}
        >
          <span className="tab-icon">➕</span>
          Thêm API mới
        </button>
      </nav>

      {/* Content */}
      <main className="app-content">
        {mainTab === "query" ? <TenantQueryTab /> : <AddApiTab />}
      </main>
    </div>
  );
};

export default App;
