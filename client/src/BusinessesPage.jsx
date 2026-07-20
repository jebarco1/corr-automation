import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  HardHat,
  Layers,
  Loader2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Store,
  Users,
  Workflow,
  Play,
  KeyRound,
  Activity
} from "lucide-react";
import { categories as categoryCatalog } from "./categoryCatalog.js";
import VendorOps from "./VendorOps.jsx";

const API = "/api/v1";
const SELECTED_KEY = "ha_corr_selected_business_id";
const KEY_MAP = "ha_corr_business_api_keys";
const KEY_STORAGE = "ha_corr_vendor_api_key";

function categoryLabel(slug) {
  return categoryCatalog.find(item => item.category === slug)?.label || slug;
}

function statusClass(status) {
  if (["won", "invoiced", "scheduled", "paid", "accepted"].includes(status)) return "success";
  if (["quoted", "contacted", "sent"].includes(status)) return "warn";
  return "";
}

function readKeyMap() {
  try {
    return JSON.parse(localStorage.getItem(KEY_MAP) || "{}");
  } catch {
    return {};
  }
}

function writeBusinessKey(businessId, apiKey) {
  const map = readKeyMap();
  map[businessId] = apiKey;
  localStorage.setItem(KEY_MAP, JSON.stringify(map));
  localStorage.setItem(KEY_STORAGE, apiKey);
  localStorage.setItem(SELECTED_KEY, businessId);
}

export default function BusinessesPage({
  selectedBusinessId,
  onSelectBusiness,
  onUseInChat,
  onOpenAutopilot,
  initialHubTab = "overview"
}) {
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState(
    selectedBusinessId || localStorage.getItem(SELECTED_KEY) || ""
  );
  const [hubTab, setHubTab] = useState(initialHubTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizard, setWizard] = useState({
    name: "",
    city: "Atlanta",
    state: "GA",
    email: "",
    phone: "",
    categories: ["landscape"],
    primaryCategory: "landscape",
    crews: 3,
    employees: 12,
    markets: "Atlanta, Decatur"
  });
  const [crmApiKey, setCrmApiKey] = useState("");

  const selected = useMemo(
    () => businesses.find(item => item.id === selectedId) || businesses[0] || null,
    [businesses, selectedId]
  );

  async function load(preferId = null) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/businesses`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load businesses");
      const list = data.businesses || [];
      setBusinesses(list);
      const preferred = preferId
        || selectedBusinessId
        || localStorage.getItem(SELECTED_KEY)
        || list[0]?.id
        || "";
      const nextId = list.some(item => item.id === preferred) ? preferred : (list[0]?.id || "");
      setSelectedId(nextId);
      const current = list.find(item => item.id === nextId) || null;
      setDraft(current ? toDraft(current) : null);
      if (current) {
        localStorage.setItem(SELECTED_KEY, current.id);
        const key = readKeyMap()[current.id] || localStorage.getItem(KEY_STORAGE) || "";
        setCrmApiKey(key);
        if (key) localStorage.setItem(KEY_STORAGE, key);
        onSelectBusiness?.(current);
      }
      setNotice(`${list.length} companies · CRM tenants linked · capacity-aware quoting`);
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
    if (initialHubTab) setHubTab(initialHubTab);
  }, [initialHubTab]);

  useEffect(() => {
    if (!selected) return;
    setDraft(toDraft(selected));
    setCrmApiKey(readKeyMap()[selected.id] || crmApiKey || "");
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
      notes: business.notes || "",
      categorySettings: { ...(business.categorySettings || {}) },
      team: {
        crews: [...(business.team?.crews || [])],
        employees: [...(business.team?.employees || [])]
      },
      markets: [...(business.markets || [])]
    };
  }

  function selectBusiness(business) {
    setSelectedId(business.id);
    localStorage.setItem(SELECTED_KEY, business.id);
    setDraft(toDraft(business));
    const key = readKeyMap()[business.id] || "";
    setCrmApiKey(key);
    if (key) localStorage.setItem(KEY_STORAGE, key);
    onSelectBusiness?.(business);
    setNotice(`${business.name} is the active company`);
    setHubTab("overview");
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
    const categorySettings = { ...draft.categorySettings };
    for (const cat of categories) {
      if (!categorySettings[cat]) {
        categorySettings[cat] = {
          hourlyRate: draft.hourlyRate,
          defaultCrewSize: draft.defaultCrewSize,
          licenseNumber: draft.licenseNumber || null,
          materialCost: 0
        };
      }
    }
    setDraft({ ...draft, categories, primaryCategory, categorySettings });
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
          categorySettings: draft.categorySettings,
          team: draft.team,
          markets: draft.markets,
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
      await load(data.business.id);
      onSelectBusiness?.(data.business);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function issueCrmKey() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/businesses/${selected.id}/crm-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "business-hub" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not issue CRM key");
      writeBusinessKey(selected.id, data.apiKey);
      setCrmApiKey(data.apiKey);
      setNotice(`CRM key issued for ${selected.name} — pipeline unlocked`);
      setHubTab("pipeline");
      await load(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createFromWizard() {
    setBusy(true);
    setError("");
    try {
      const markets = String(wizard.markets || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map((city, i) => ({
          city,
          state: wizard.state || "GA",
          zips: [],
          primary: i === 0
        }));
      const res = await fetch(`${API}/businesses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wizard.name,
          city: wizard.city,
          state: wizard.state,
          email: wizard.email,
          phone: wizard.phone,
          categories: wizard.categories,
          primaryCategory: wizard.primaryCategory,
          crews: Number(wizard.crews),
          employees: Number(wizard.employees),
          markets
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      if (data.apiKey) writeBusinessKey(data.business.id, data.apiKey);
      setShowWizard(false);
      setNotice(`Created ${data.business.name} · CRM tenant + first session ready`);
      await load(data.business.id);
      setHubTab("overview");
      onSelectBusiness?.(data.business);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function promoteSession(session) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      if (!crmApiKey) await issueCrmKey();
      const res = await fetch(`${API}/businesses/${selected.id}/sessions/${session.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send: false })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Promote failed");
      setNotice(`Promoted “${session.title}” into CRM${data.quote ? ` · quote ${data.quote.id}` : ""}`);
      await load(selected.id);
      setHubTab("pipeline");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openSessionInChat(session) {
    onUseInChat?.(selected, { category: session.category, session });
  }

  function runAutopilotForBusiness() {
    onOpenAutopilot?.(selected);
  }

  const health = selected?.health || {};
  const capacity = selected?.capacity || {};

  return (
    <section className="businesses-page">
      <div className="card businesses-hero">
        <div>
          <p className="eyebrow">COMPANY WORKSPACE</p>
          <h2>Businesses</h2>
          <p>
            Each business is a real CRM tenant — pricebook, booking page, pipeline, team, markets,
            and capacity-aware quotes in one place.
          </p>
        </div>
        <div className="inline-actions wrap">
          <button className="primary" type="button" onClick={() => setShowWizard(true)} disabled={busy}>
            <Plus size={16} /> New business
          </button>
          <button className="ghost" type="button" onClick={() => load()} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {showWizard && (
        <div className="card onboarding-wizard">
          <div className="panel-head">
            <h3>Create a business</h3>
            <small>Seeds CRM tenant, pricebook, markets, team, and a first session</small>
          </div>
          <div className="grid two compact-fields">
            <label className="field"><span>Business name</span>
              <input value={wizard.name} onChange={e => setWizard({ ...wizard, name: e.target.value })} placeholder="Acme Field Services" />
            </label>
            <label className="field"><span>Primary city</span>
              <input value={wizard.city} onChange={e => setWizard({ ...wizard, city: e.target.value })} />
            </label>
            <label className="field"><span>Email</span>
              <input value={wizard.email} onChange={e => setWizard({ ...wizard, email: e.target.value })} />
            </label>
            <label className="field"><span>Phone</span>
              <input value={wizard.phone} onChange={e => setWizard({ ...wizard, phone: e.target.value })} />
            </label>
            <label className="field"><span>Crews</span>
              <input type="number" value={wizard.crews} onChange={e => setWizard({ ...wizard, crews: Number(e.target.value) })} />
            </label>
            <label className="field"><span>Employees</span>
              <input type="number" value={wizard.employees} onChange={e => setWizard({ ...wizard, employees: Number(e.target.value) })} />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}><span>Service markets (comma-separated cities)</span>
              <input value={wizard.markets} onChange={e => setWizard({ ...wizard, markets: e.target.value })} />
            </label>
          </div>
          <div className="chip-row">
            {categoryCatalog.map(item => {
              const active = wizard.categories.includes(item.category);
              return (
                <button
                  key={item.category}
                  type="button"
                  className={`chip ${active ? "active" : ""}`}
                  onClick={() => {
                    const categories = active
                      ? wizard.categories.filter(c => c !== item.category)
                      : [...wizard.categories, item.category];
                    const next = categories.length ? categories : [item.category];
                    setWizard({
                      ...wizard,
                      categories: next,
                      primaryCategory: next.includes(wizard.primaryCategory) ? wizard.primaryCategory : next[0]
                    });
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="inline-actions wrap">
            <button className="primary" type="button" disabled={busy || !wizard.name.trim()} onClick={createFromWizard}>
              <Plus size={16} /> Create company
            </button>
            <button className="ghost" type="button" onClick={() => setShowWizard(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="businesses-layout">
        <div className="card">
          <div className="panel-head">
            <h3>Companies</h3>
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
                <small>{business.categories.map(categoryLabel).join(" · ")}</small>
                <em>
                  <HardHat size={12} /> {business.crews} crews · <Users size={12} /> {business.employees} employees
                  {business.health?.openQuotes != null ? ` · ${business.health.openQuotes} open quotes` : ""}
                </em>
              </button>
            ))}
          </div>
        </div>

        <div className="card business-detail">
          {!selected || !draft ? (
            <p className="muted">Select or create a business to open the company workspace.</p>
          ) : (
            <>
              <div className="panel-head">
                <h3>{selected.name}</h3>
                <span className="step">{selected.status}</span>
              </div>
              <p className="muted">
                {selected.legalName} · CRM {selected.vendor?.slug || "linking…"} ·{" "}
                <a href={selected.bookingPath} target="_blank" rel="noreferrer">{selected.bookingPath}</a>
              </p>

              <div className="health-strip">
                <div><Activity size={14} /><small>Open quotes</small><strong>{health.openQuotes ?? 0}</strong></div>
                <div><small>Win rate</small><strong>{health.winRate != null ? `${health.winRate}%` : "—"}</strong></div>
                <div><small>Utilization</small><strong>{Math.round((capacity.utilization || 0) * 100)}%</strong></div>
                <div><small>Follow-ups</small><strong>{health.overdueFollowUps ?? 0}</strong></div>
                <div><small>Jobs open</small><strong>{health.openJobs ?? 0}</strong></div>
              </div>

              <div className="hub-tabs" role="tablist">
                {[
                  ["overview", "Overview"],
                  ["profile", "Profile"],
                  ["team", "Team"],
                  ["markets", "Markets"],
                  ["sessions", "Sessions"],
                  ["pipeline", "Pipeline"]
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={hubTab === id ? "active" : ""}
                    onClick={() => setHubTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {hubTab === "overview" && (
                <div className="hub-panel">
                  <dl className="mini-dl">
                    <div><dt>Crews</dt><dd>{selected.crews}</dd></div>
                    <div><dt>Employees</dt><dd>{selected.employees}</dd></div>
                    <div><dt>Rec. crew size</dt><dd>{capacity.recommendedCrewSize || selected.defaultCrewSize}</dd></div>
                    <div><dt>Rate factor</dt><dd>{capacity.rateMultiplier || 1}×</dd></div>
                    <div><dt>Sessions</dt><dd>{selected.sessionCount || 0}</dd></div>
                    <div><dt>Markets</dt><dd>{selected.markets?.length || 0}</dd></div>
                  </dl>
                  <p className="muted">
                    Capacity-aware quoting uses crew/employee load ({capacity.empPerCrew || "—"} emp/crew)
                    {capacity.overtimeRisk ? " — overtime risk high." : "."}
                  </p>
                  <div className="inline-actions wrap">
                    <button className="primary" type="button" onClick={() => onUseInChat?.(selected)}>
                      <Workflow size={16} /> Quote in AI Chat
                    </button>
                    <button className="ghost" type="button" onClick={runAutopilotForBusiness}>
                      <Play size={16} /> Run Autopilot
                    </button>
                    <button className="ghost" type="button" onClick={issueCrmKey} disabled={busy}>
                      <KeyRound size={16} /> {crmApiKey ? "Re-issue CRM key" : "Unlock pipeline"}
                    </button>
                    <button className="ghost" type="button" onClick={() => setHubTab("pipeline")}>
                      <Store size={16} /> Open pipeline
                    </button>
                  </div>
                </div>
              )}

              {hubTab === "profile" && (
                <div className="hub-panel">
                  <label className="field">
                    <span>Business name</span>
                    <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                  </label>
                  <div className="grid two compact-fields">
                    <label className="field"><span>Billing email</span>
                      <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} />
                    </label>
                    <label className="field"><span>Phone</span>
                      <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} />
                    </label>
                    <label className="field"><span>License</span>
                      <input value={draft.licenseNumber} onChange={e => setDraft({ ...draft, licenseNumber: e.target.value })} />
                    </label>
                    <label className="field"><span>Default hourly</span>
                      <input type="number" value={draft.hourlyRate} onChange={e => setDraft({ ...draft, hourlyRate: Number(e.target.value) })} />
                    </label>
                    <label className="field"><span>Crews</span>
                      <input type="number" value={draft.crews} onChange={e => setDraft({ ...draft, crews: Number(e.target.value) })} />
                    </label>
                    <label className="field"><span>Employees</span>
                      <input type="number" value={draft.employees} onChange={e => setDraft({ ...draft, employees: Number(e.target.value) })} />
                    </label>
                  </div>
                  <div className="category-attach">
                    <div className="panel-head">
                      <h4><Layers size={16} /> Categories + per-trade rates</h4>
                    </div>
                    <div className="chip-row">
                      {categoryCatalog.map(item => (
                        <button
                          key={item.category}
                          type="button"
                          className={`chip ${draft.categories.includes(item.category) ? "active" : ""}`}
                          onClick={() => toggleCategory(item.category)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    {draft.categories.map(cat => {
                      const cs = draft.categorySettings[cat] || {};
                      return (
                        <div key={cat} className="cat-rate-row">
                          <strong>{categoryLabel(cat)}</strong>
                          <label className="field compact"><span>Hourly</span>
                            <input
                              type="number"
                              value={cs.hourlyRate ?? draft.hourlyRate}
                              onChange={e => setDraft({
                                ...draft,
                                categorySettings: {
                                  ...draft.categorySettings,
                                  [cat]: { ...cs, hourlyRate: Number(e.target.value) }
                                }
                              })}
                            />
                          </label>
                          <label className="field compact"><span>Crew size</span>
                            <input
                              type="number"
                              value={cs.defaultCrewSize ?? draft.defaultCrewSize}
                              onChange={e => setDraft({
                                ...draft,
                                categorySettings: {
                                  ...draft.categorySettings,
                                  [cat]: { ...cs, defaultCrewSize: Number(e.target.value) }
                                }
                              })}
                            />
                          </label>
                          <label className="field compact"><span>License</span>
                            <input
                              value={cs.licenseNumber || ""}
                              onChange={e => setDraft({
                                ...draft,
                                categorySettings: {
                                  ...draft.categorySettings,
                                  [cat]: { ...cs, licenseNumber: e.target.value }
                                }
                              })}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <button className="primary" type="button" onClick={saveDraft} disabled={busy}>
                    <Save size={16} /> Save profile
                  </button>
                </div>
              )}

              {hubTab === "team" && (
                <div className="hub-panel">
                  <div className="panel-head"><h4><HardHat size={16} /> Crews</h4></div>
                  <ul className="session-list">
                    {(draft.team.crews || []).map(crew => (
                      <li key={crew.id}>
                        <div>
                          <strong>{crew.name}</strong>
                          <small>Lead {crew.lead} · size {crew.size} · {(crew.categories || []).map(categoryLabel).join(", ")}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="panel-head" style={{ marginTop: 12 }}><h4><Users size={16} /> Employees</h4></div>
                  <ul className="session-list">
                    {(draft.team.employees || []).map(emp => (
                      <li key={emp.id}>
                        <div>
                          <strong>{emp.name}</strong>
                          <small>{emp.role} · {(emp.categories || []).map(categoryLabel).join(", ")}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="muted">Counts sync from roster on save. Edit crew/employee totals in Profile for capacity quoting.</p>
                  <button className="primary" type="button" onClick={saveDraft} disabled={busy}>
                    <Save size={16} /> Save team capacity
                  </button>
                </div>
              )}

              {hubTab === "markets" && (
                <div className="hub-panel">
                  <div className="panel-head"><h4><MapPin size={16} /> Service areas</h4></div>
                  <ul className="session-list">
                    {(draft.markets || []).map((market, idx) => (
                      <li key={`${market.city}-${idx}`}>
                        <div>
                          <strong>{market.city}, {market.state}</strong>
                          <small>
                            {(market.zips || []).join(", ") || "city-wide"}
                            {market.primary ? " · primary" : ""}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <label className="field">
                    <span>Add market (City, ST)</span>
                    <div className="inline-actions">
                      <input
                        id="new-market"
                        placeholder="Macon, GA"
                        onKeyDown={e => {
                          if (e.key !== "Enter") return;
                          const raw = e.currentTarget.value.trim();
                          if (!raw) return;
                          const [city, state = "GA"] = raw.split(",").map(s => s.trim());
                          setDraft({
                            ...draft,
                            markets: [...draft.markets, { city, state, zips: [], primary: false }]
                          });
                          e.currentTarget.value = "";
                        }}
                      />
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          const el = document.getElementById("new-market");
                          const raw = el?.value?.trim();
                          if (!raw) return;
                          const [city, state = "GA"] = raw.split(",").map(s => s.trim());
                          setDraft({
                            ...draft,
                            markets: [...draft.markets, { city, state, zips: [], primary: false }]
                          });
                          if (el) el.value = "";
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </label>
                  <button className="primary" type="button" onClick={saveDraft} disabled={busy}>
                    <Save size={16} /> Save markets
                  </button>
                </div>
              )}

              {hubTab === "sessions" && (
                <div className="hub-panel">
                  <div className="panel-head">
                    <h4><Workflow size={16} /> Session timeline</h4>
                    <small>Open in chat, promote to CRM, or jump to Autopilot</small>
                  </div>
                  <ul className="session-list actionable">
                    {(selected.sessions || []).map(session => (
                      <li key={session.id}>
                        <div>
                          <strong>{session.title}</strong>
                          <small>{categoryLabel(session.category)} · {session.kind} · {session.customerName || "—"}</small>
                          <p>{session.summary}</p>
                          <div className="inline-actions wrap">
                            <button className="ghost" type="button" onClick={() => openSessionInChat(session)}>
                              Open in chat
                            </button>
                            <button className="ghost" type="button" onClick={() => promoteSession(session)} disabled={busy}>
                              Promote to CRM
                            </button>
                            <button className="ghost" type="button" onClick={runAutopilotForBusiness}>
                              Autopilot
                            </button>
                          </div>
                        </div>
                        <span className={`step ${statusClass(session.status)}`}>{session.status}</span>
                      </li>
                    ))}
                    {!selected.sessions?.length && <li className="muted">No sessions yet — quote in AI Chat or run Autopilot.</li>}
                  </ul>
                </div>
              )}

              {hubTab === "pipeline" && (
                <div className="hub-panel pipeline-embed">
                  {!crmApiKey ? (
                    <div className="inline-actions wrap">
                      <p className="muted">Issue a CRM key to unlock this company’s Vendor Ops pipeline.</p>
                      <button className="primary" type="button" onClick={issueCrmKey} disabled={busy}>
                        <KeyRound size={16} /> Unlock pipeline
                      </button>
                    </div>
                  ) : (
                    <VendorOps
                      initialLeadId={null}
                      controlledApiKey={crmApiKey}
                      embedded
                      businessName={selected.name}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
