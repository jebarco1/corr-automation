import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCopy,
  ExternalLink,
  Lightbulb,
  Mail,
  MapPin,
  Phone,
  Play,
  Sparkles,
  Target,
  Users
} from "lucide-react";
import { buildAutopilotResults } from "./autopilotSim.js";

function formatUsd(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function priorityClass(priority) {
  if (priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}

export default function AutopilotResults({
  leads = [],
  jobs = [],
  metrics = {},
  scenario,
  elapsed = 0,
  onBack,
  onRunAgain,
  onOpenVendor,
  onPromoteToVendor,
  initialLeadId = null,
  initialJobId = null
}) {
  const results = useMemo(
    () => buildAutopilotResults({
      leads,
      jobs,
      metrics,
      category: scenario?.category,
      label: scenario?.label,
      summary: scenario?.summary,
      elapsed
    }),
    [leads, jobs, metrics, scenario, elapsed]
  );

  const [selectedLeadId, setSelectedLeadId] = useState(
    initialLeadId || results.leads[0]?.id || null
  );
  const [selectedJobId, setSelectedJobId] = useState(initialJobId || null);
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState("leads");
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    if (initialLeadId) setSelectedLeadId(initialLeadId);
  }, [initialLeadId]);

  useEffect(() => {
    if (initialJobId) {
      setSelectedJobId(initialJobId);
      setPanel("jobs");
    }
  }, [initialJobId]);

  const selectedLead = results.leads.find(lead => lead.id === selectedLeadId) || results.leads[0] || null;
  const selectedJob = results.jobs.find(job => job.id === (selectedJobId || selectedLead?.job?.id))
    || results.jobs[0]
    || null;

  async function runSuggestion(suggestion) {
    setNotice("");
    switch (suggestion.actionType) {
      case "select-lead":
        if (suggestion.leadId) {
          setSelectedLeadId(suggestion.leadId);
          setPanel("leads");
        }
        break;
      case "select-job":
        if (suggestion.jobId) {
          setSelectedJobId(suggestion.jobId);
          setPanel("jobs");
          if (suggestion.leadId) setSelectedLeadId(suggestion.leadId);
        }
        break;
      case "open-vendor":
        onOpenVendor?.();
        break;
      case "run-again":
        onRunAgain?.();
        break;
      case "back-live":
        onBack?.();
        break;
      case "open-booking":
        window.open(suggestion.href || "/book/demo-landscape", "_blank", "noopener,noreferrer");
        break;
      case "copy-script":
        try {
          await navigator.clipboard.writeText(suggestion.copyText || "");
          setNotice("Outreach script copied to clipboard.");
        } catch {
          setNotice(suggestion.copyText || "Could not copy — select the script text manually.");
        }
        break;
      default:
        break;
    }
  }

  async function copyField(label, value) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setNotice(`${label} copied.`);
    } catch {
      setNotice(`${label}: ${value}`);
    }
  }

  async function promoteSimLeads() {
    if (!onPromoteToVendor || promoting) return;
    setPromoting(true);
    setNotice("");
    try {
      const result = await onPromoteToVendor({
        category: scenario?.category,
        leads: results.leads
      });
      setNotice(result?.message || `Promoted ${result?.imported || results.leads.length} sim leads to Vendor Ops.`);
    } catch (err) {
      setNotice(err.message || "Could not promote leads");
    } finally {
      setPromoting(false);
    }
  }

  const { value } = results;

  return (
    <section className="autopilot-results">
      <div className="card autopilot-results-hero">
        <div>
          <p className="eyebrow">CYCLE RESULTS</p>
          <h2>
            <span className="autopilot-mark">Autopilot</span>
            <span className="autopilot-sub"> delivered {results.label}</span>
          </h2>
          <p>
            Review every lead and job from this cycle, see the value created, and act on ranked suggestions.
          </p>
          <div className="autopilot-actions">
            <button className="ghost" type="button" onClick={onBack}>
              <ArrowLeft size={16} />
              Back to live board
            </button>
            <button className="primary" type="button" onClick={onRunAgain}>
              <Play size={16} />
              Run again
            </button>
            <button className="ghost" type="button" onClick={() => onOpenVendor?.()}>
              <ExternalLink size={16} />
              Open Vendor Ops
            </button>
            {onPromoteToVendor && (
              <button className="primary" type="button" onClick={promoteSimLeads} disabled={promoting || !results.leads.length}>
                <Users size={16} />
                {promoting ? "Promoting…" : "Promote sim → Vendor Ops"}
              </button>
            )}
          </div>
        </div>
        <div className="results-value-grid">
          <div className="results-value-card accent">
            <CircleDollarSign size={18} />
            <small>Revenue captured</small>
            <strong>{formatUsd(value.revenue)}</strong>
            <span>Net after ~{formatUsd(value.spend)} API spend · {formatUsd(value.net)}</span>
          </div>
          <div className="results-value-card">
            <Target size={18} />
            <small>ROI vs spend</small>
            <strong>{value.roiMultiple != null ? `${value.roiMultiple}×` : "—"}</strong>
            <span>{value.conversionRate}% lead → won · {value.elapsed}s runtime</span>
          </div>
          <div className="results-value-card">
            <Users size={18} />
            <small>Pipeline still open</small>
            <strong>{formatUsd(value.openPipeline)}</strong>
            <span>{value.leads} leads · {value.quotes} quotes · {value.jobs} jobs</span>
          </div>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}

      <div className="card results-suggestions">
        <div className="panel-head">
          <h3><Lightbulb size={18} /> Suggested next moves</h3>
          <small>Ranked by impact on this cycle</small>
        </div>
        <div className="suggestion-grid">
          {results.suggestions.map(item => (
            <article key={item.id} className={`suggestion-card ${priorityClass(item.priority)}`}>
              <header>
                <span className={`priority-pill ${item.priority}`}>{item.priority}</span>
                <strong>{item.title}</strong>
              </header>
              <p>{item.detail}</p>
              <button className="primary" type="button" onClick={() => runSuggestion(item)}>
                <Sparkles size={14} />
                {item.actionLabel}
              </button>
            </article>
          ))}
          {!results.suggestions.length && (
            <p className="muted">Run a cycle to generate suggestions.</p>
          )}
        </div>
      </div>

      <div className="results-tabs" role="tablist">
        <button
          type="button"
          className={panel === "leads" ? "active" : ""}
          onClick={() => setPanel("leads")}
        >
          <Users size={15} /> Leads ({results.leads.length})
        </button>
        <button
          type="button"
          className={panel === "jobs" ? "active" : ""}
          onClick={() => setPanel("jobs")}
        >
          <Briefcase size={15} /> Jobs ({results.jobs.length})
        </button>
      </div>

      {panel === "leads" && (
        <div className="results-split">
          <div className="card">
            <div className="panel-head">
              <h3>All leads</h3>
              <small>Click a row for full detail + actions</small>
            </div>
            <div className="results-table">
              {results.leads.map(lead => (
                <button
                  key={lead.id}
                  type="button"
                  className={`results-row ${selectedLead?.id === lead.id ? "active" : ""}`}
                  onClick={() => setSelectedLeadId(lead.id)}
                >
                  <span className="stage-pill">{lead.stageLabel}</span>
                  <strong>{lead.name}</strong>
                  <small>{lead.market} · score {lead.score}</small>
                  <em>{formatUsd(lead.quoteAmount)}</em>
                </button>
              ))}
              {!results.leads.length && <p className="muted">No leads in this cycle yet.</p>}
            </div>
          </div>

          <div className="card results-detail">
            {selectedLead ? (
              <>
                <div className="panel-head">
                  <h3>{selectedLead.name}</h3>
                  <span className="step">{selectedLead.stageLabel}</span>
                </div>
                <p className="detail-service">{selectedLead.service} · {selectedLead.segment.toUpperCase()} · {selectedLead.customerType}</p>
                <dl className="mini-dl">
                  <div><dt>Score</dt><dd>{selectedLead.score}</dd></div>
                  <div><dt>Quote value</dt><dd>{formatUsd(selectedLead.quoteAmount)}</dd></div>
                  <div><dt>Market</dt><dd>{selectedLead.market}</dd></div>
                  <div><dt>Contacts</dt><dd>{selectedLead.completeness}/3 fields</dd></div>
                </dl>
                <div className="contact-block">
                  <div><MapPin size={14} /><span>{selectedLead.address}</span></div>
                  <div><Phone size={14} /><span>{selectedLead.phone}</span></div>
                  <div><Mail size={14} /><span>{selectedLead.email}</span></div>
                </div>
                <div className="inline-actions wrap">
                  <a className="primary" href={`tel:${selectedLead.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone size={14} /> Call
                  </a>
                  <a className="ghost" href={`mailto:${selectedLead.email}?subject=${encodeURIComponent(`${selectedLead.service} quote`)}`}>
                    <Mail size={14} /> Email
                  </a>
                  <button className="ghost" type="button" onClick={() => copyField("Phone", selectedLead.phone)}>
                    <ClipboardCopy size={14} /> Copy phone
                  </button>
                  <button className="ghost" type="button" onClick={() => copyField("Email", selectedLead.email)}>
                    <ClipboardCopy size={14} /> Copy email
                  </button>
                  {selectedLead.job && (
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => {
                        setSelectedJobId(selectedLead.job.id);
                        setPanel("jobs");
                      }}
                    >
                      <Briefcase size={14} /> View job
                    </button>
                  )}
                </div>
                {selectedLead.job && (
                  <div className="job-mini">
                    <CheckCircle2 size={16} />
                    <div>
                      <strong>{selectedLead.job.title}</strong>
                      <small>{selectedLead.job.assignee} · {selectedLead.job.scheduledLabel} · {selectedLead.job.status}</small>
                    </div>
                    <b>{formatUsd(selectedLead.job.amount)}</b>
                  </div>
                )}
              </>
            ) : (
              <p className="muted">Select a lead to see details and actions.</p>
            )}
          </div>
        </div>
      )}

      {panel === "jobs" && (
        <div className="results-split">
          <div className="card">
            <div className="panel-head">
              <h3>Jobs from this cycle</h3>
              <small>Scheduled and paid work Autopilot created</small>
            </div>
            <div className="results-table">
              {results.jobs.map(job => (
                <button
                  key={job.id}
                  type="button"
                  className={`results-row ${selectedJob?.id === job.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedJobId(job.id);
                    setSelectedLeadId(job.leadId);
                  }}
                >
                  <span className="stage-pill">{job.status}</span>
                  <strong>{job.customer}</strong>
                  <small>{job.title} · {job.assignee}</small>
                  <em>{formatUsd(job.amount)}</em>
                </button>
              ))}
              {!results.jobs.length && (
                <p className="muted">No jobs yet — win a quote in the next cycle to populate this list.</p>
              )}
            </div>
          </div>

          <div className="card results-detail">
            {selectedJob ? (
              <>
                <div className="panel-head">
                  <h3>{selectedJob.title}</h3>
                  <span className={`step ${selectedJob.status === "paid" ? "success" : ""}`}>{selectedJob.status}</span>
                </div>
                <p className="detail-service">{selectedJob.customer}</p>
                <dl className="mini-dl">
                  <div><dt>Amount</dt><dd>{formatUsd(selectedJob.amount)}</dd></div>
                  <div><dt>Assignee</dt><dd>{selectedJob.assignee}</dd></div>
                  <div><dt>Window</dt><dd>{selectedJob.scheduledLabel}</dd></div>
                  <div><dt>Market</dt><dd>{selectedJob.market}</dd></div>
                  {selectedJob.paidAmount != null && (
                    <div><dt>Paid</dt><dd>{formatUsd(selectedJob.paidAmount)}</dd></div>
                  )}
                </dl>
                <div className="contact-block">
                  <div><MapPin size={14} /><span>{selectedJob.address}</span></div>
                  <div><Phone size={14} /><span>{selectedJob.phone}</span></div>
                  <div><Mail size={14} /><span>{selectedJob.email}</span></div>
                </div>
                <div className="inline-actions wrap">
                  <a className="primary" href={`tel:${String(selectedJob.phone || "").replace(/[^\d+]/g, "")}`}>
                    <Phone size={14} /> Call customer
                  </a>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      setSelectedLeadId(selectedJob.leadId);
                      setPanel("leads");
                    }}
                  >
                    <Users size={14} /> View lead
                  </button>
                  <button className="ghost" type="button" onClick={() => onOpenVendor?.()}>
                    <ExternalLink size={14} /> Manage in Vendor Ops
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Select a job to see schedule and payment detail.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
