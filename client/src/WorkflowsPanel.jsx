import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import { categories as localCategories } from "./categoryCatalog.js";

const API = "/api/v1";

function labelFor(category) {
  return localCategories.find(item => item.category === category)?.label || category;
}

export default function WorkflowsPanel({ request }) {
  const [catalog, setCatalog] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [busyCategory, setBusyCategory] = useState("");
  const [busyAll, setBusyAll] = useState(false);
  const [runLog, setRunLog] = useState([]);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoadError("");
    try {
      const [list, workflowList] = await Promise.all([
        fetch(`${API}/pricing-standards`).then(r => r.json()),
        fetch(`${API}/workflows`).then(r => r.json())
      ]);
      setCatalog(list.categories || []);
      setWorkflows(workflowList.workflows || []);
    } catch (err) {
      setLoadError(err.message || "Failed to load workflows");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function pushLog(entry) {
    setRunLog(prev => [{ at: new Date().toISOString(), ...entry }, ...prev].slice(0, 20));
  }

  async function playCategory(category) {
    setBusyCategory(category);
    try {
      const result = await request(`${API}/${category}/workflows/industry-standards`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setSelectedDetail(result);
      pushLog({
        category,
        status: "completed",
        mode: result.mode,
        version: result.standards?.version,
        rationale: result.rationale
      });
      await load();
    } catch (err) {
      pushLog({ category, status: "failed", rationale: err.message });
    } finally {
      setBusyCategory("");
    }
  }

  async function playAll() {
    setBusyAll(true);
    try {
      const result = await request(`${API}/workflows/industry-standards`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setSelectedDetail(result);
      pushLog({
        category: "all",
        status: "completed",
        mode: "batch",
        rationale: `Updated ${result.completed || 0} / ${result.count || 0} categories`
      });
      await load();
    } catch (err) {
      pushLog({ category: "all", status: "failed", rationale: err.message });
    } finally {
      setBusyAll(false);
    }
  }

  const industryWorkflow = workflows.find(item => item.id === "industry-standards");

  return (
    <section className="grid workflows">
      <div className="card workflow-hero">
        <div className="workflow-hero-copy">
          <span className="step">PRICING WORKFLOWS</span>
          <h2>Update industry-standard rates</h2>
          <p>
            {industryWorkflow?.description
              || "Hit Play to ask AI for current mid-market industry prices, then write the category pricing-standards JSON."}
          </p>
        </div>
        <div className="workflow-hero-actions">
          <button className="ghost" onClick={load} disabled={busyAll || Boolean(busyCategory)}>
            <RefreshCw size={16} /> Reload
          </button>
          <button className="primary" onClick={playAll} disabled={busyAll || Boolean(busyCategory)}>
            {busyAll ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
            Play all categories
          </button>
        </div>
      </div>

      {loadError && <div className="error landing-span">{loadError}</div>}

      <div className="card workflow-table-card">
        <div className="workflow-table-head">
          <h3>Industry standards by category</h3>
          <p>Each Play run asks AI for standards and updates <code>data/pricing-standards/&#123;category&#125;.json</code>.</p>
        </div>
        <div className="workflow-table">
          <div className="workflow-row head">
            <span>Category</span>
            <span>Version</span>
            <span>Areas</span>
            <span>Updated</span>
            <span>Action</span>
          </div>
          {catalog.map(item => {
            const running = busyCategory === item.category || busyAll;
            return (
              <div className="workflow-row" key={item.category}>
                <div>
                  <strong>{labelFor(item.category)}</strong>
                  <small>{item.category}</small>
                </div>
                <span>v{item.version}</span>
                <span>{item.areaCount}</span>
                <span>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}</span>
                <button
                  className="primary play-btn"
                  disabled={running}
                  onClick={() => playCategory(item.category)}
                  title="Ask AI for industry standards and update JSON"
                >
                  {busyCategory === item.category ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                  Play
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card side-panel">
        <h3><Sparkles size={16} /> Latest run</h3>
        {!selectedDetail && <p>Run a workflow to see AI rationale and JSON changes here.</p>}
        {selectedDetail?.workflow === "industry-standards" && (
          <>
            <dl className="mini-dl">
              <div><dt>Category</dt><dd>{labelFor(selectedDetail.category)}</dd></div>
              <div><dt>Mode</dt><dd>{selectedDetail.mode}</dd></div>
              <div><dt>Version</dt><dd>v{selectedDetail.standards?.version}</dd></div>
              <div>
                <dt>Default hourly</dt>
                <dd>
                  ${selectedDetail.changes?.defaultHourlyBefore ?? "—"} → ${selectedDetail.changes?.defaultHourlyAfter ?? "—"}
                </dd>
              </div>
            </dl>
            <p className="rationale">{selectedDetail.rationale}</p>
            <h3>Area hourly changes</h3>
            <div className="chips">
              {(selectedDetail.changes?.areas || []).map(area => (
                <span key={area.area}>
                  {area.area}: ${area.hourlyRateBefore ?? "—"} → ${area.hourlyRateAfter ?? "—"}
                </span>
              ))}
            </div>
            <h3>Saved JSON preview</h3>
            <pre>{JSON.stringify({
              category: selectedDetail.standards?.category,
              version: selectedDetail.standards?.version,
              defaults: selectedDetail.standards?.defaults,
              areas: Object.fromEntries(
                Object.entries(selectedDetail.standards?.areas || {}).map(([area, value]) => [
                  area,
                  value.unitPrices
                ])
              )
            }, null, 2)}</pre>
          </>
        )}
        {selectedDetail?.workflow === "industry-standards-all" && (
          <>
            <p className="rationale">Batch complete: {selectedDetail.completed}/{selectedDetail.count} categories updated.</p>
            <div className="chips">
              {(selectedDetail.results || []).map(item => (
                <span key={item.category}>
                  {item.status === "completed" ? <CheckCircle2 size={12} /> : null}
                  {labelFor(item.category)} {item.status === "completed" ? `v${item.standards?.version}` : item.error}
                </span>
              ))}
            </div>
          </>
        )}

        <h3>Run log</h3>
        {!runLog.length && <p>No runs yet.</p>}
        <ul className="run-log">
          {runLog.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <strong>{entry.category === "all" ? "All categories" : labelFor(entry.category)}</strong>
              <small>{new Date(entry.at).toLocaleTimeString()} · {entry.status}{entry.mode ? ` · ${entry.mode}` : ""}</small>
              <p>{entry.rationale}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
