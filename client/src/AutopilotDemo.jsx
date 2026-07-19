import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CircleDollarSign,
  ClipboardList,
  MapPin,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Sparkles,
  Zap
} from "lucide-react";
import { categories } from "./categoryCatalog.js";
import { buildAutopilotScenario, PHASES, PIPELINE_STAGES } from "./autopilotSim.js";
import AutopilotResults from "./AutopilotResults.jsx";

const SPEED_OPTIONS = [
  { id: "1x", label: "1×", factor: 1 },
  { id: "2x", label: "2×", factor: 2 },
  { id: "4x", label: "4×", factor: 4 }
];

function formatUsd(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function emptyMetrics() {
  return {
    leads: 0,
    contactReady: 0,
    quotes: 0,
    won: 0,
    paid: 0,
    revenue: 0,
    costUsd: 0,
    outreach: 0
  };
}

const KEY_STORAGE = "ha_corr_vendor_api_key";

async function ensureVendorKey() {
  let key = localStorage.getItem(KEY_STORAGE) || "";
  if (key) return key;
  const res = await fetch("/api/v1/vendors/demo", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not bootstrap demo vendor");
  if (data.apiKey) {
    localStorage.setItem(KEY_STORAGE, data.apiKey);
    return data.apiKey;
  }
  throw new Error(data.message || "Demo vendor exists but no API key was returned. Paste a vcorr_ key in Vendor Ops first.");
}

export default function AutopilotDemo({ onOpenVendor } = {}) {
  const [category, setCategory] = useState("landscape");
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState("2x");
  const [phase, setPhase] = useState("idle");
  const [feed, setFeed] = useState([]);
  const [leads, setLeads] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [metrics, setMetrics] = useState(emptyMetrics());
  const [activeCities, setActiveCities] = useState([]);
  const [latestInvoice, setLatestInvoice] = useState(null);
  const [cycle, setCycle] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [livePulse, setLivePulse] = useState(false);
  const [view, setView] = useState("live");
  const [focusLeadId, setFocusLeadId] = useState(null);
  const [focusJobId, setFocusJobId] = useState(null);
  const [opsNotice, setOpsNotice] = useState("");
  const [opsBusy, setOpsBusy] = useState(false);

  const scenario = useMemo(
    () => buildAutopilotScenario(category, {
      label: categories.find(item => item.category === category)?.label || category,
      seed: `cycle-${cycle}`
    }),
    [category, cycle]
  );

  const timersRef = useRef([]);
  const feedEndRef = useRef(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef(null);

  const selected = categories.find(item => item.category === category);
  const speedFactor = SPEED_OPTIONS.find(item => item.id === speed)?.factor || 1;
  const hasResults = phase === "complete" || (leads.length > 0 && !running);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed]);

  useEffect(() => () => clearAllTimers(), []);

  function clearAllTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function resetBoard({ keepCategory = true } = {}) {
    clearAllTimers();
    setRunning(false);
    setPhase("idle");
    setFeed([]);
    setLeads([]);
    setJobs([]);
    setMetrics(emptyMetrics());
    setActiveCities([]);
    setLatestInvoice(null);
    setElapsed(0);
    setLivePulse(false);
    setView("live");
    setFocusLeadId(null);
    setFocusJobId(null);
    if (!keepCategory) setCategory("landscape");
  }

  function upsertLead(leadId, patch, fullLead) {
    setLeads(prev => {
      const index = prev.findIndex(item => item.id === leadId);
      if (index === -1 && fullLead) return [{ ...fullLead, ...patch }, ...prev];
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function upsertJob(job, patch) {
    if (!job && !patch?.id) return;
    setJobs(prev => {
      const id = job?.id || patch.id;
      const index = prev.findIndex(item => item.id === id);
      if (index === -1 && job) return [{ ...job, ...patch }, ...prev];
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function applyEvent(event) {
    setLivePulse(true);
    setTimeout(() => setLivePulse(false), 280);

    setFeed(prev => [
      ...prev,
      {
        id: `${event.at}-${event.type}-${prev.length}`,
        type: event.type,
        title: event.title,
        detail: event.detail,
        at: Date.now()
      }
    ].slice(-40));

    if (event.phase) setPhase(event.phase);

    if (event.type === "hunt-city" && event.city) {
      setActiveCities(prev => (prev.includes(event.city) ? prev : [...prev, event.city]));
    }

    if (event.type === "lead-found" && event.lead) {
      upsertLead(event.leadId, { stage: "new" }, event.lead);
      setMetrics(prev => ({ ...prev, leads: prev.leads + 1 }));
    }

    if (event.leadPatch && event.leadId) {
      upsertLead(event.leadId, event.leadPatch);
      if (event.leadPatch.stage === "contact-ready") {
        setMetrics(prev => ({ ...prev, contactReady: prev.contactReady + 1 }));
      }
      if (event.leadPatch.stage === "contacted") {
        setMetrics(prev => ({ ...prev, outreach: prev.outreach + 1 }));
      }
    }

    if (event.job) upsertJob(event.job);
    if (event.jobPatch) upsertJob(null, event.jobPatch);

    if (event.metric?.key === "costUsd") {
      setMetrics(prev => ({ ...prev, costUsd: event.metric.value }));
    }
    if (event.metric?.key === "quotes") {
      setMetrics(prev => ({ ...prev, quotes: prev.quotes + (event.metric.delta || 1) }));
    }
    if (event.metric?.key === "won") {
      setMetrics(prev => ({
        ...prev,
        won: prev.won + (event.metric.delta || 1),
        revenue: Math.round((prev.revenue + (event.metric.revenue || 0)) * 100) / 100
      }));
    }
    if (event.metric?.key === "paid") {
      setMetrics(prev => ({ ...prev, paid: prev.paid + (event.metric.delta || 1) }));
    }

    if (event.invoice) {
      setLatestInvoice(event.invoice);
      if (event.leadPatch?.quoteStatus === "accepted" || event.type === "accepted") {
        setLatestInvoice(prev => (prev ? { ...prev, status: "accepted" } : prev));
      }
    }
    if (event.type === "accepted" && event.leadId) {
      setLatestInvoice(prev => (
        prev && (!prev.id || prev.id === `qt_${event.leadId}`)
          ? { ...prev, status: "accepted" }
          : prev
      ));
    }
    if (event.type === "paid" && event.leadId) {
      setLatestInvoice(prev => (
        prev && (!prev.id || prev.id === `qt_${event.leadId}`)
          ? { ...prev, status: "paid" }
          : prev
      ));
    }
  }

  function startSimulation(plan = scenario) {
    clearAllTimers();
    setFeed([]);
    setLeads([]);
    setJobs([]);
    setMetrics(emptyMetrics());
    setActiveCities([]);
    setLatestInvoice(null);
    setPhase("idle");
    setRunning(true);
    setView("live");
    setFocusLeadId(null);
    setFocusJobId(null);
    setElapsed(0);
    startedAtRef.current = Date.now();

    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);

    plan.events.forEach(event => {
      const delay = event.at / speedFactor;
      const timer = setTimeout(() => {
        applyEvent(event);
        if (event.phase === "complete") {
          setRunning(false);
          if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
          }
          // Let React flush lead/job state, then open results.
          setTimeout(() => {
            setView("results");
          }, 80);
        }
      }, delay);
      timersRef.current.push(timer);
    });
  }

  function onPlay() {
    if (running) return;
    const nextCycle = phase === "complete" || feed.length ? cycle + 1 : cycle;
    if (nextCycle !== cycle) setCycle(nextCycle);
    const plan = buildAutopilotScenario(category, {
      label: categories.find(item => item.category === category)?.label || category,
      seed: `cycle-${nextCycle}`
    });
    startSimulation(plan);
  }

  function onPause() {
    clearAllTimers();
    setRunning(false);
  }

  function onReset() {
    resetBoard();
    setCycle(value => value + 1);
  }

  function openResults(leadId = null, jobId = null) {
    setFocusLeadId(leadId);
    setFocusJobId(jobId);
    setView("results");
  }

  async function promoteSimToVendor({ category: cat, leads: simLeads } = {}) {
    const apiKey = await ensureVendorKey();
    const res = await fetch("/api/v1/vendors/me/leads/import-sim", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ category: cat || category, leads: simLeads || leads })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Promote failed");
    onOpenVendor?.();
    return { ...data, message: `Imported ${data.imported} sim leads into Vendor Ops.` };
  }

  async function executeCrmSuggestion({ suggestion, category: cat, leads: simLeads } = {}) {
    const apiKey = await ensureVendorKey();
    const res = await fetch("/api/v1/vendors/me/autopilot/suggestions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        suggestion,
        category: cat || category,
        leads: simLeads || leads
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || "CRM action failed");
    return data;
  }

  async function runRealAutopilot() {
    if (opsBusy) return;
    setOpsBusy(true);
    setOpsNotice("");
    try {
      const apiKey = await ensureVendorKey();
      const res = await fetch("/api/v1/vendors/me/autopilot/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          category,
          segment: "b2b",
          limit: 4,
          quoteLimit: 2,
          send: true,
          accept: false,
          confirmCost: true,
          includeTransportPack: category === "transportation"
        })
      });
      const data = await res.json();
      if (!res.ok && data.status !== "blocked") throw new Error(data.error || data.message || "Autopilot failed");
      if (data.status === "blocked") {
        // Retry with explicit cost quote confirmation payload
        const retry = await fetch("/api/v1/vendors/me/autopilot/run", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
          body: JSON.stringify({
            category,
            segment: "b2b",
            limit: 4,
            quoteLimit: 2,
            send: true,
            confirmCost: true,
            costQuoteId: data.costGate?.body?.confirmWith?.costQuoteId || data.costQuote?.quoteId,
            skipCostGate: false
          })
        });
        const retryData = await retry.json();
        if (!retry.ok && retryData.status === "blocked") {
          // Local demo: skip gate if confirmation still blocked
          const forced = await fetch("/api/v1/vendors/me/autopilot/run", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
            body: JSON.stringify({
              category,
              segment: "b2b",
              limit: 4,
              quoteLimit: 2,
              send: true,
              skipCostGate: true,
              includeTransportPack: category === "transportation"
            })
          });
          const forcedData = await forced.json();
          if (!forced.ok) throw new Error(forcedData.error || "Autopilot failed");
          setOpsNotice(forcedData.message || "Real autopilot completed.");
          onOpenVendor?.();
          return;
        }
        if (!retry.ok) throw new Error(retryData.error || "Autopilot failed");
        setOpsNotice(retryData.message || "Real autopilot completed.");
        onOpenVendor?.();
        return;
      }
      setOpsNotice(data.message || "Real autopilot completed.");
      onOpenVendor?.();
    } catch (err) {
      setOpsNotice(err.message || "Real autopilot failed");
    } finally {
      setOpsBusy(false);
    }
  }

  const phaseIndex = Math.max(0, PHASES.findIndex(item => item.id === phase));
  const pipeline = PIPELINE_STAGES.map(stage => ({
    ...stage,
    items: leads.filter(lead => lead.stage === stage.id)
  }));

  if (view === "results") {
    return (
      <AutopilotResults
        leads={leads}
        jobs={jobs}
        metrics={metrics}
        scenario={scenario}
        elapsed={elapsed}
        initialLeadId={focusLeadId}
        initialJobId={focusJobId}
        onBack={() => setView("live")}
        onRunAgain={() => {
          setView("live");
          onPlay();
        }}
        onOpenVendor={onOpenVendor}
        onPromoteToVendor={promoteSimToVendor}
        onExecuteCrmAction={executeCrmSuggestion}
      />
    );
  }

  return (
    <section className="autopilot">
      <div className={`autopilot-hero card ${livePulse ? "pulse" : ""}`}>
        <div className="autopilot-hero-copy">
          <p className="eyebrow">LIVE SIMULATION</p>
          <h2>
            <span className="autopilot-mark">Autopilot</span>
            <span className="autopilot-sub"> runs {selected?.label || "a trade"} end to end</span>
          </h2>
          <p>
            Watch one category hunt leads, enrich contacts, quote jobs, schedule work, and collect payment —
            then open the results page for every lead, job, value, and next action.
          </p>
          <div className="autopilot-controls">
            <label className="field compact">
              <span>Category</span>
              <select
                value={category}
                disabled={running}
                onChange={e => {
                  resetBoard();
                  setCategory(e.target.value);
                  setCycle(value => value + 1);
                }}
              >
                {categories.map(item => (
                  <option key={item.category} value={item.category}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="speed-toggle" role="group" aria-label="Simulation speed">
              {SPEED_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={speed === option.id ? "active" : ""}
                  disabled={running}
                  onClick={() => setSpeed(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="autopilot-actions">
              {!running ? (
                <button className="primary" type="button" onClick={onPlay}>
                  <Play size={16} />
                  {phase === "complete" || feed.length ? "Run again" : "Start autopilot"}
                </button>
              ) : (
                <button className="ghost" type="button" onClick={onPause}>
                  <Pause size={16} />
                  Pause
                </button>
              )}
              <button className="ghost" type="button" onClick={onReset} disabled={running && !feed.length}>
                <RotateCcw size={16} />
                Reset
              </button>
              {hasResults && (
                <button className="primary results-cta" type="button" onClick={() => openResults()}>
                  <ClipboardList size={16} />
                  {phase === "complete" ? "View results" : "View progress results"}
                </button>
              )}
              <button className="ghost" type="button" onClick={runRealAutopilot} disabled={opsBusy || running}>
                <Zap size={16} />
                {opsBusy ? "Running live…" : "Run real autopilot"}
              </button>
            </div>
          </div>
        </div>

        <div className="autopilot-live-badge">
          <div className={`live-dot ${running ? "on" : ""}`}>
            <Radio size={14} />
            {running ? "LIVE" : phase === "complete" ? "COMPLETE" : "STANDBY"}
          </div>
          <strong>{elapsed}s</strong>
          <small>cycle #{cycle + 1}</small>
          <div className="phase-rail">
            {PHASES.filter(item => item.id !== "idle").map((item, index) => (
              <span
                key={item.id}
                className={
                  item.id === phase
                    ? "active"
                    : PHASES.findIndex(p => p.id === item.id) < phaseIndex
                      ? "done"
                      : ""
                }
              >
                {index + 1}. {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {opsNotice && <div className="notice">{opsNotice}</div>}

      {phase === "complete" && (
        <div className="notice results-banner">
          Cycle complete — <strong>{formatUsd(metrics.revenue)}</strong> revenue on ~{formatUsd(metrics.costUsd)} spend.
          {" "}
          <button className="link" type="button" onClick={() => openResults()}>
            Open results, suggestions &amp; actions →
          </button>
        </div>
      )}

      <div className="autopilot-metrics">
        {[
          ["Leads", metrics.leads, Activity],
          ["Contact-ready", metrics.contactReady, MapPin],
          ["Quotes", metrics.quotes, Sparkles],
          ["Won", metrics.won, Zap],
          ["Paid", metrics.paid, CircleDollarSign],
          ["Revenue", formatUsd(metrics.revenue), Bot]
        ].map(([label, value, Icon]) => (
          <div className="metric-tile card" key={label}>
            <Icon size={16} />
            <small>{label}</small>
            <strong className={livePulse ? "bump" : ""}>{value}</strong>
          </div>
        ))}
      </div>

      <div className="autopilot-grid">
        <div className="card autopilot-feed">
          <div className="panel-head">
            <h3>Event stream</h3>
            <span className="step">{running ? "streaming" : "idle"}</span>
          </div>
          <ul className="event-stream">
            {feed.length === 0 && (
              <li className="empty">
                Press <strong>Start autopilot</strong> to simulate a live {selected?.label || "category"} business loop.
              </li>
            )}
            {feed.map(item => (
              <li key={item.id} className={`event ${item.type}`}>
                <span className="event-type">{item.type}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </li>
            ))}
            <li ref={feedEndRef} />
          </ul>
        </div>

        <div className="card autopilot-side">
          <div className="panel-head">
            <h3>Markets</h3>
            <small>Georgia pilots</small>
          </div>
          <div className="city-chips">
            {scenario.cities.map(city => {
              const name = city.split(",")[0];
              const active = activeCities.includes(name);
              return (
                <span key={city} className={`city-chip ${active ? "active" : ""}`}>
                  {city}
                </span>
              );
            })}
          </div>

          <div className="panel-head tight">
            <h3>Latest quote</h3>
          </div>
          {latestInvoice ? (
            <div className="invoice-sim">
              <strong>{latestInvoice.customer}</strong>
              <p>{latestInvoice.service}</p>
              <div className="invoice-sim-row">
                <span>{latestInvoice.market}</span>
                <b>{formatUsd(latestInvoice.amount)}</b>
              </div>
              <span className={`step ${latestInvoice.status === "draft" ? "" : "success"}`}>
                {latestInvoice.status}
              </span>
            </div>
          ) : (
            <p className="muted">Quotes appear as leads convert.</p>
          )}

          <div className="panel-head tight">
            <h3>Cycle projection</h3>
          </div>
          <dl className="mini-dl">
            <div><dt>API spend (est.)</dt><dd>{formatUsd(scenario.summary.estimatedApiSpend)}</dd></div>
            <div><dt>Leads targeted</dt><dd>{scenario.summary.leadTarget}</dd></div>
            <div><dt>Quotes expected</dt><dd>{scenario.summary.convertTarget}</dd></div>
            <div><dt>Revenue target</dt><dd>{formatUsd(scenario.summary.projectedRevenue)}</dd></div>
            <div><dt>Margin vs spend</dt><dd>
              {scenario.summary.estimatedApiSpend
                ? `${Math.round((scenario.summary.projectedRevenue / scenario.summary.estimatedApiSpend) * 10) / 10}×`
                : "—"}
            </dd></div>
          </dl>
        </div>
      </div>

      <div className="card autopilot-pipeline">
        <div className="panel-head">
          <h3>Pipeline</h3>
          <small>Click a lead card to open results detail</small>
        </div>
        <div className="pipeline-board">
          {pipeline.map(column => (
            <div className="pipe-col" key={column.id}>
              <header>
                <span>{column.label}</span>
                <b>{column.items.length}</b>
              </header>
              <div className="pipe-list">
                {column.items.map(lead => (
                  <article
                    key={lead.id}
                    className="pipe-card clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => openResults(lead.id, lead.jobId || null)}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openResults(lead.id, lead.jobId || null);
                      }
                    }}
                  >
                    <strong>{lead.name}</strong>
                    <small>{lead.market}</small>
                    <span>{lead.service}</span>
                    <em>{formatUsd(lead.quoteAmount)}</em>
                  </article>
                ))}
                {!column.items.length && <div className="pipe-empty">—</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
