import React, { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, Layers, ListFilter, Search } from "lucide-react";

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

function ServiceCard({ service, open, onToggle }) {
  return (
    <article className={`svc-card ${open ? "open" : ""}`}>
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

export default function ServiceCatalogPage() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [guidedOnly, setGuidedOnly] = useState(false);
  const [openIds, setOpenIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/service-docs`)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load service docs (${r.status})`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        setDocs(data);
        setCategory(data.categories?.[0]?.category || "");
      })
      .catch(err => {
        if (!cancelled) setError(err.message || "Failed to load service catalog");
      });
    return () => { cancelled = true; };
  }, []);

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

  function expandAll() {
    setOpenIds(new Set(filtered.map(service => service.id)));
  }

  function collapseAll() {
    setOpenIds(new Set());
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

  return (
    <section className="svc-page">
      <div className="card svc-hero">
        <div>
          <p className="eyebrow">SERVICE REFERENCE</p>
          <h2>Every service, input, and formula</h2>
          <p>
            Browse all {docs.totalServices} services across {docs.count} categories.
            Each entry shows the description, guided inputs, and the pricing calculation used for quotes.
          </p>
        </div>
        <div className="svc-hero-stats">
          <div><strong>{docs.count}</strong><small>categories</small></div>
          <div><strong>{docs.totalServices}</strong><small>services</small></div>
          <div><strong>{selected?.count || 0}</strong><small>in view</small></div>
        </div>
      </div>

      <div className="svc-layout">
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
                    <button type="button" className="ghost" onClick={expandAll}>Expand all</button>
                    <button type="button" className="ghost" onClick={collapseAll}>Collapse</button>
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
                    onToggle={() => toggle(service.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
