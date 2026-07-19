import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Calculator, Check, ChevronDown, Layers, ListFilter, Search, Send, Sparkles, X } from "lucide-react";

const API = "/api/v1";

function InputRow({ input }) {
  return (
    <li className="svc-input-row">
      <div>
        <strong>{input.key}</strong>
        <small>{input.label}</small>
      </div>
      <div className="svc-input-meta">
        <span className="svc-pill">{input.type}</span>
        {input.required ? <span className="svc-pill warn">required</span> : <span className="svc-pill">optional</span>}
        {input.askedOfUser ? <span className="svc-pill ask">ask user</span> : <span className="svc-pill auto">auto</span>}
      </div>
    </li>
  );
}

function ServiceCard({ service, open, onToggle, selected, onSelect }) {
  return (
    <article className={`svc-card ${open ? "open" : ""} ${selected ? "selected" : ""}`}>
      <button type="button" className="svc-card-head" onClick={onToggle} aria-expanded={open}>
        <div>
          <strong>{service.name}</strong>
          <p>{service.description}</p>
        </div>
        <div className="svc-card-badges">
          {service.inGuidedWorkflow && <span className="svc-pill ok">guided</span>}
          {service.billingUnit && <span className="svc-pill">{service.billingUnit}</span>}
          {service.defaultHours != null && <span className="svc-pill">{service.defaultHours}h</span>}
          <ChevronDown size={18} className="svc-chevron" />
        </div>
      </button>

      {open && (
        <div className="svc-card-body">
          <div className="svc-card-actions">
            <button type="button" className="ghost" onClick={onSelect}>
              <Bot size={14} /> Use in AI chat
            </button>
          </div>

          <section>
            <h4>Required inputs</h4>
            <ul className="svc-input-list">
              {service.inputs.map(input => (
                <InputRow key={input.key} input={input} />
              ))}
            </ul>
          </section>

          <section className="svc-calc">
            <h4><Calculator size={16} /> Formula / calculation</h4>
            <p className="svc-calc-summary">{service.calculation.summary}</p>
            <pre className="svc-formula">{service.calculation.formula}</pre>
            {!!service.calculation.notes?.length && (
              <ul className="svc-notes">
                {service.calculation.notes.map(note => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </section>

          {!!service.relatedApis?.length && (
            <section>
              <h4>Related APIs</h4>
              <div className="chips">
                {service.relatedApis.map(api => (
                  <span key={api}>{api}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </article>
  );
}

function recommendationName(rec) {
  return rec?.preview?.name
    || rec?.patch?.service?.name
    || (rec?.type === "add_service" ? String(rec.title || "").replace(/^add(?:\s+service)?\s*:?\s*/i, "").trim() : "")
    || rec?.title
    || "Service update";
}

function RecommendationCard({ rec, busy, onApply, onDismiss }) {
  const name = recommendationName(rec);
  const actionLabel = rec.type === "add_service"
    ? "Suggested service"
    : rec.type.replace(/_/g, " ");
  return (
    <div className={`svc-rec ${rec.status}`}>
      <div className="svc-rec-head">
        <div>
          <small className="svc-rec-kind">{actionLabel}</small>
          <strong className="svc-rec-name">{name}</strong>
        </div>
        <span className="svc-pill">{rec.type.replace(/_/g, " ")}</span>
      </div>
      <p>{rec.rationale}</p>
      {(rec.preview?.description || rec.preview?.after) && (
        <p className="svc-rec-desc">
          {typeof (rec.preview.description || rec.preview.after) === "string"
            ? (rec.preview.description || rec.preview.after)
            : null}
        </p>
      )}
      {rec.preview?.formula && (
        <pre className="svc-rec-preview">{rec.preview.formula}</pre>
      )}
      {rec.preview?.issues?.length > 0 && (
        <ul className="svc-notes">
          {rec.preview.issues.slice(0, 4).map(issue => (
            <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      {rec.status === "pending" ? (
        <div className="svc-rec-actions">
          <button type="button" className="primary" disabled={busy} onClick={onApply}>
            <Check size={14} /> Apply {rec.type === "add_service" ? name : "update"}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={onDismiss}>
            <X size={14} /> Dismiss
          </button>
        </div>
      ) : (
        <small className="svc-rec-status">{rec.status === "applied" ? `Applied: ${name}` : "Dismissed"}</small>
      )}
    </div>
  );
}

export default function ServiceCatalogPage() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [guidedOnly, setGuidedOnly] = useState(false);
  const [openIds, setOpenIds] = useState(() => new Set());
  const [focusServiceId, setFocusServiceId] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [chatLog, setChatLog] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [suggestedServices, setSuggestedServices] = useState([]);
  const chatEndRef = useRef(null);

  async function reloadDocs(preferredCategory) {
    const data = await fetch(`${API}/service-docs`).then(r => {
      if (!r.ok) throw new Error(`Failed to load service docs (${r.status})`);
      return r.json();
    });
    setDocs(data);
    const nextCategory = preferredCategory || category || data.categories?.[0]?.category || "";
    setCategory(nextCategory);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    reloadDocs()
      .catch(err => {
        if (!cancelled) setError(err.message || "Failed to load service catalog");
      });
    fetch(`${API}/ai/status`)
      .then(r => r.json())
      .then(status => { if (!cancelled) setAiEnabled(!!status.enabled); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLog, recommendations]);

  useEffect(() => {
    // Reset advisor thread when category changes
    setSessionId(null);
    setChatLog([{
      role: "assistant",
      text: `Ask me to add a service, update a description or formula, or check inputs for ${category || "this category"}. Apply a recommendation to write it into the catalog.`
    }]);
    setRecommendations([]);
    setFocusServiceId(null);
    setChatError("");
    setSuggestedServices([]);

    if (!category) return undefined;
    let cancelled = false;
    fetch(`${API}/service-docs/${encodeURIComponent(category)}/suggestions`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setSuggestedServices(data.suggestions || []);
      })
      .catch(() => {
        if (!cancelled) setSuggestedServices([]);
      });
    return () => { cancelled = true; };
  }, [category]);

  const selected = useMemo(
    () => docs?.categories?.find(item => item.category === category) || null,
    [docs, category]
  );

  const filtered = useMemo(() => {
    if (!selected) return [];
    const q = query.trim().toLowerCase();
    return selected.services.filter(service => {
      if (guidedOnly && !service.inGuidedWorkflow) return false;
      if (!q) return true;
      const hay = [
        service.name,
        service.description,
        service.quoteKey,
        ...(service.aliases || []),
        ...(service.relatedApis || [])
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [selected, query, guidedOnly]);

  function toggle(id) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function syncAdvisor(payload) {
    if (payload.sessionId) setSessionId(payload.sessionId);
    if (payload.messages) setChatLog(payload.messages);
    else if (payload.reply) {
      setChatLog(prev => [...prev, { role: "assistant", text: payload.reply }]);
    }
    if (payload.recommendations) setRecommendations(payload.recommendations);
    if (payload.focusServiceId) setFocusServiceId(payload.focusServiceId);
    if (payload.catalog) setDocs(payload.catalog);
    else if (payload.docs && selected) {
      setDocs(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          categories: prev.categories.map(item => (
            item.category === payload.docs.category ? payload.docs : item
          )),
          totalServices: prev.categories.reduce((sum, item) => (
            sum + (item.category === payload.docs.category ? payload.docs.count : item.count)
          ), 0)
        };
      });
    }
  }

  async function sendChat(message) {
    const text = String(message || "").trim();
    if (!text || !category || chatBusy) return;
    setChatBusy(true);
    setChatError("");
    setChatLog(prev => [...prev, { role: "user", text }]);
    setChatInput("");
    try {
      const res = await fetch(`${API}/service-docs/advisor/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          category,
          serviceId: focusServiceId,
          message: text
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`);
      syncAdvisor(data);
      if (data.applied) {
        await reloadDocs(category);
      }
    } catch (err) {
      setChatError(err.message || "Chat failed");
    } finally {
      setChatBusy(false);
    }
  }

  async function applyRec(recommendationId) {
    if (!sessionId || chatBusy) return;
    setChatBusy(true);
    setChatError("");
    try {
      const res = await fetch(`${API}/service-docs/advisor/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, recommendationId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Apply failed (${res.status})`);
      syncAdvisor(data);
      await reloadDocs(category);
      if (data.applied?.serviceId || data.focusServiceId) {
        const id = data.focusServiceId || data.applied.serviceId;
        setFocusServiceId(id);
        setOpenIds(prev => new Set(prev).add(id));
      }
    } catch (err) {
      setChatError(err.message || "Apply failed");
    } finally {
      setChatBusy(false);
    }
  }

  async function dismissRec(recommendationId) {
    if (!sessionId || chatBusy) return;
    setChatBusy(true);
    try {
      const res = await fetch(`${API}/service-docs/advisor/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, recommendationId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Dismiss failed (${res.status})`);
      syncAdvisor(data);
    } catch (err) {
      setChatError(err.message || "Dismiss failed");
    } finally {
      setChatBusy(false);
    }
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!docs) {
    return (
      <section className="card svc-loading">
        <p className="eyebrow">SERVICE CATALOG</p>
        <h2>Loading services…</h2>
      </section>
    );
  }

  const pendingRecs = recommendations.filter(item => item.status === "pending");
  const focusName = selected?.services?.find(item => item.id === focusServiceId)?.name;

  return (
    <section className="svc-page">
      <div className="card svc-hero">
        <div>
          <p className="eyebrow">SERVICE REFERENCE</p>
          <h2>Every service, input, and formula</h2>
          <p>
            Browse all {docs.totalServices} services across {docs.count} categories.
            Use the AI advisor to suggest new services, update descriptions/calculations, validate inputs, and apply changes.
          </p>
        </div>
        <div className="svc-hero-stats">
          <div><strong>{docs.count}</strong><small>categories</small></div>
          <div><strong>{docs.totalServices}</strong><small>services</small></div>
          <div><strong>{selected?.count || 0}</strong><small>in view</small></div>
        </div>
      </div>

      <div className="svc-layout with-chat">
        <aside className="card svc-cats">
          <div className="svc-cats-head">
            <Layers size={16} />
            <strong>Categories</strong>
          </div>
          <ul>
            {docs.categories.map(item => (
              <li key={item.category}>
                <button
                  type="button"
                  className={item.category === category ? "active" : ""}
                  onClick={() => {
                    setCategory(item.category);
                    setOpenIds(new Set());
                  }}
                >
                  <span>{item.label}</span>
                  <small>{item.count}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="svc-main">
          {selected && (
            <>
              <div className="card svc-toolbar">
                <div>
                  <p className="eyebrow">{selected.category}</p>
                  <h3>{selected.label}</h3>
                  <p>{selected.description}</p>
                </div>
                <div className="svc-tools">
                  <label className="field compact svc-search">
                    <span><Search size={14} /> Search</span>
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Name, alias, or API…"
                    />
                  </label>
                  <label className="svc-toggle">
                    <input
                      type="checkbox"
                      checked={guidedOnly}
                      onChange={e => setGuidedOnly(e.target.checked)}
                    />
                    <ListFilter size={14} />
                    Guided only
                  </label>
                  <div className="svc-tool-actions">
                    <button type="button" className="ghost" onClick={() => setOpenIds(new Set(filtered.map(s => s.id)))}>Expand all</button>
                    <button type="button" className="ghost" onClick={() => setOpenIds(new Set())}>Collapse</button>
                  </div>
                </div>
              </div>

              {selected.categoryCalculation && (
                <div className="card svc-category-calc">
                  <h4><Calculator size={16} /> Category default formula</h4>
                  <p>{selected.categoryCalculation.summary}</p>
                  <pre className="svc-formula">{selected.categoryCalculation.formula}</pre>
                </div>
              )}

              <div className="svc-list">
                {filtered.length === 0 && (
                  <div className="card"><p>No services match this filter.</p></div>
                )}
                {filtered.map(service => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    open={openIds.has(service.id)}
                    selected={focusServiceId === service.id}
                    onToggle={() => toggle(service.id)}
                    onSelect={() => setFocusServiceId(service.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="card svc-advisor">
          <div className="svc-advisor-head">
            <div>
              <p className="eyebrow">AI SERVICE ADVISOR</p>
              <h3><Sparkles size={18} /> Catalog chatbot</h3>
              <p>
                {aiEnabled ? "OpenAI enabled" : "Local advisor mode"}
                {focusName ? ` · focused on ${focusName}` : ""}
              </p>
            </div>
          </div>

          <div className="svc-advisor-prompts">
            <p className="svc-suggest-label">Suggested services for {selected?.label || category}</p>
            {suggestedServices.length === 0 && (
              <span className="svc-suggest-empty">Loading category suggestions…</span>
            )}
            {suggestedServices.map(item => (
              <button
                key={item.id || item.name}
                type="button"
                className="prompt-chip mini svc-suggest-chip"
                disabled={chatBusy}
                onClick={() => sendChat(item.prompt || `Add service "${item.name}"`)}
                title={item.description}
              >
                {item.name}
              </button>
            ))}
            <button
              type="button"
              className="prompt-chip mini"
              disabled={chatBusy || !focusName}
              onClick={() => sendChat(`Update the description for ${focusName}`)}
            >
              Update description
            </button>
            <button
              type="button"
              className="prompt-chip mini"
              disabled={chatBusy || !focusName}
              onClick={() => sendChat(`Improve the calculation formula for ${focusName}`)}
            >
              Improve formula
            </button>
            <button
              type="button"
              className="prompt-chip mini"
              disabled={chatBusy || !focusName}
              onClick={() => sendChat(`Check input variables for ${focusName}`)}
            >
              Check inputs
            </button>
          </div>

          <div className="svc-advisor-chat">
            {chatLog.map((item, index) => (
              <div key={`${item.role}-${index}`} className={`bubble ${item.role}`}>
                <strong>{item.role === "assistant" ? "Advisor" : "You"}</strong>
                <p>{item.text}</p>
              </div>
            ))}
            {chatBusy && <div className="bubble assistant typing"><strong>Advisor</strong><p>Thinking…</p></div>}
            <div ref={chatEndRef} />
          </div>

          {chatError && <div className="error">{chatError}</div>}

          {!!pendingRecs.length && (
            <div className="svc-rec-list">
              <h4>Recommendations</h4>
              {pendingRecs.map(rec => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  busy={chatBusy}
                  onApply={() => applyRec(rec.id)}
                  onDismiss={() => dismissRec(rec.id)}
                />
              ))}
            </div>
          )}

          {recommendations.some(item => item.status === "applied") && (
            <div className="svc-rec-list applied-list">
              <h4>Applied</h4>
              {recommendations.filter(item => item.status === "applied").slice(-3).map(rec => (
                <RecommendationCard key={rec.id} rec={rec} busy={chatBusy} onApply={() => {}} onDismiss={() => {}} />
              ))}
            </div>
          )}

          <form
            className="svc-advisor-composer"
            onSubmit={e => {
              e.preventDefault();
              sendChat(chatInput);
            }}
          >
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder='Try: add a service called "…" or check inputs'
              disabled={chatBusy}
            />
            <button className="primary" type="submit" disabled={chatBusy || !chatInput.trim()}>
              <Send size={16} />
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
