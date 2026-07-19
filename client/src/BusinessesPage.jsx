import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  HardHat,
  Layers,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Save,
  Users,
  Workflow
} from "lucide-react";
import { categories as categoryCatalog } from "./categoryCatalog.js";

const API = "/api/v1";
const SELECTED_KEY = "ha_corr_selected_business_id";

function categoryLabel(slug) {
  return categoryCatalog.find(item => item.category === slug)?.label || slug;
}

function statusClass(status) {
  if (["won", "invoiced", "scheduled", "paid"].includes(status)) return "success";
  if (["quoted", "contacted"].includes(status)) return "warn";
  return "";
}

export default function BusinessesPage({
  selectedBusinessId,
  onSelectBusiness,
  onUseInChat
}) {
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState(
    selectedBusinessId || localStorage.getItem(SELECTED_KEY) || ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(null);

  const selected = useMemo(
    () => businesses.find(item => item.id === selectedId) || businesses[0] || null,
    [businesses, selectedId]
  );

  async function load() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/businesses`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load businesses");
      const list = data.businesses || [];
      setBusinesses(list);
      const preferred = selectedBusinessId
        || localStorage.getItem(SELECTED_KEY)
        || list[0]?.id
        || "";
      const nextId = list.some(item => item.id === preferred) ? preferred : (list[0]?.id || "");
      setSelectedId(nextId);
      const current = list.find(item => item.id === nextId) || null;
      setDraft(current ? toDraft(current) : null);
      if (current) {
        localStorage.setItem(SELECTED_KEY, current.id);
        onSelectBusiness?.(current);
      }
      setNotice(`${list.length} businesses · sessions attached`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDraft(toDraft(selected));
  }, [selected?.id]);

  function toDraft(business) {
    return {
      name: business.name,
      email: business.email || "",
      phone: business.phone || "",
      licenseNumber: business.licenseNumber || "",
      crews: business.crews,
      employees: business.employees,
      defaultCrewSize: business.defaultCrewSize,
      categories: [...(business.categories || [])],
      primaryCategory: business.primaryCategory || business.categories?.[0] || "",
      hourlyRate: business.unitPrices?.hourlyRate ?? 95,
      taxRate: business.invoiceDefaults?.taxRate ?? 8.9,
      discount: business.invoiceDefaults?.discount ?? 0,
      paymentTerms: business.invoiceDefaults?.paymentTerms || "Net 15",
      notes: business.notes || ""
    };
  }

  function selectBusiness(business) {
    setSelectedId(business.id);
    localStorage.setItem(SELECTED_KEY, business.id);
    setDraft(toDraft(business));
    onSelectBusiness?.(business);
    setNotice(`${business.name} selected as active business`);
  }

  function toggleCategory(slug) {
    if (!draft) return;
    const has = draft.categories.includes(slug);
    let categories = has
      ? draft.categories.filter(item => item !== slug)
      : [...draft.categories, slug];
    if (!categories.length) categories = [slug];
    const primaryCategory = categories.includes(draft.primaryCategory)
      ? draft.primaryCategory
      : categories[0];
    setDraft({ ...draft, categories, primaryCategory });
  }

  async function saveDraft() {
    if (!selected || !draft) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/businesses/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          licenseNumber: draft.licenseNumber,
          crews: Number(draft.crews),
          employees: Number(draft.employees),
          defaultCrewSize: Number(draft.defaultCrewSize),
          categories: draft.categories,
          primaryCategory: draft.primaryCategory,
          notes: draft.notes,
          unitPrices: {
            ...(selected.unitPrices || {}),
            hourlyRate: Number(draft.hourlyRate)
          },
          invoiceDefaults: {
            ...(selected.invoiceDefaults || {}),
            taxRate: Number(draft.taxRate),
            discount: Number(draft.discount),
            paymentTerms: draft.paymentTerms
          }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setNotice(`Saved ${data.business.name}`);
      await load();
      onSelectBusiness?.(data.business);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="businesses-page">
      <div className="card businesses-hero">
        <div>
          <p className="eyebrow">TENANT DIRECTORY</p>
          <h2>Businesses</h2>
          <p>
            Existing field-service businesses with attached quote sessions. Each company can offer
            multiple trade categories and tracks crew / employee capacity.
          </p>
        </div>
        <button className="ghost" type="button" onClick={load} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          Refresh
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="businesses-layout">
        <div className="card">
          <div className="panel-head">
            <h3>Existing businesses</h3>
            <small>{businesses.length}</small>
          </div>
          <div className="business-list">
            {businesses.map(business => (
              <button
                key={business.id}
                type="button"
                className={`business-row ${selected?.id === business.id ? "active" : ""}`}
                onClick={() => selectBusiness(business)}
              >
                <strong>{business.name}</strong>
                <span>{business.city}, {business.state}</span>
                <small>
                  {business.categories.map(categoryLabel).join(" · ")}
                </small>
                <em>
                  <HardHat size={12} /> {business.crews} crews · <Users size={12} /> {business.employees} employees
                </em>
              </button>
            ))}
            {!businesses.length && !busy && (
              <p className="muted">No businesses seeded yet.</p>
            )}
          </div>
        </div>

        <div className="card business-detail">
          {!selected || !draft ? (
            <p className="muted">Select a business to view capacity, categories, and sessions.</p>
          ) : (
            <>
              <div className="panel-head">
                <h3>{selected.name}</h3>
                <span className="step">{selected.status}</span>
              </div>
              <p className="muted">{selected.legalName}</p>
              <div className="contact-block">
                <div><MapPin size={14} /><span>{selected.address}, {selected.city}, {selected.state} {selected.zip}</span></div>
                <div><Phone size={14} /><span>{selected.phone}</span></div>
                <div><Building2 size={14} /><span>{selected.email}</span></div>
              </div>

              <dl className="mini-dl">
                <div><dt>Crews</dt><dd>{draft.crews}</dd></div>
                <div><dt>Employees</dt><dd>{draft.employees}</dd></div>
                <div><dt>Default crew size</dt><dd>{draft.defaultCrewSize}</dd></div>
                <div><dt>Sessions</dt><dd>{selected.sessionCount || selected.sessions?.length || 0}</dd></div>
              </dl>

              <label className="field">
                <span>Business name</span>
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <div className="grid two compact-fields">
                <label className="field">
                  <span>Billing email</span>
                  <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} />
                </label>
                <label className="field">
                  <span>Phone</span>
                  <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} />
                </label>
                <label className="field">
                  <span>License</span>
                  <input value={draft.licenseNumber} onChange={e => setDraft({ ...draft, licenseNumber: e.target.value })} />
                </label>
                <label className="field">
                  <span>Crews</span>
                  <input type="number" value={draft.crews} onChange={e => setDraft({ ...draft, crews: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Employees</span>
                  <input type="number" value={draft.employees} onChange={e => setDraft({ ...draft, employees: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Default crew size</span>
                  <input type="number" value={draft.defaultCrewSize} onChange={e => setDraft({ ...draft, defaultCrewSize: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Hourly rate</span>
                  <input type="number" value={draft.hourlyRate} onChange={e => setDraft({ ...draft, hourlyRate: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Tax rate (%)</span>
                  <input type="number" value={draft.taxRate} onChange={e => setDraft({ ...draft, taxRate: Number(e.target.value) })} />
                </label>
              </div>

              <div className="category-attach">
                <div className="panel-head">
                  <h4><Layers size={16} /> Categories offered</h4>
                  <small>Multi-select — businesses can run several trades</small>
                </div>
                <div className="chip-row">
                  {categoryCatalog.map(item => {
                    const active = draft.categories.includes(item.category);
                    return (
                      <button
                        key={item.category}
                        type="button"
                        className={`chip ${active ? "active" : ""}`}
                        onClick={() => toggleCategory(item.category)}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <label className="field compact">
                  <span>Primary category</span>
                  <select
                    value={draft.primaryCategory}
                    onChange={e => setDraft({ ...draft, primaryCategory: e.target.value })}
                  >
                    {draft.categories.map(slug => (
                      <option key={slug} value={slug}>{categoryLabel(slug)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="inline-actions wrap">
                <button className="primary" type="button" onClick={saveDraft} disabled={busy}>
                  <Save size={16} /> Save business
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => onUseInChat?.(selected)}
                >
                  <Workflow size={16} /> Use in AI Chat
                </button>
              </div>

              <div className="attached-sessions">
                <div className="panel-head">
                  <h4><Workflow size={16} /> Attached sessions</h4>
                  <small>{selected.sessions?.length || 0} on this business</small>
                </div>
                <ul className="session-list">
                  {(selected.sessions || []).map(session => (
                    <li key={session.id}>
                      <div>
                        <strong>{session.title}</strong>
                        <small>{categoryLabel(session.category)} · {session.kind} · {session.customerName || "—"}</small>
                        <p>{session.summary}</p>
                      </div>
                      <span className={`step ${statusClass(session.status)}`}>{session.status}</span>
                    </li>
                  ))}
                  {!selected.sessions?.length && (
                    <li className="muted">No sessions attached yet.</li>
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
