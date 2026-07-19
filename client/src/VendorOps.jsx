import React, { useEffect, useState } from "react";
import { Briefcase, KeyRound, Link2, Loader2, Plus, RefreshCw, Send, UserPlus } from "lucide-react";

const API = "/api/v1";
const KEY_STORAGE = "ha_corr_vendor_api_key";

async function vendorFetch(path, { apiKey, method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function VendorOps({ initialLeadId = null } = {}) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) || "");
  const [vendor, setVendor] = useState(null);
  const [leads, setLeads] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("alex");
  const [quoteAmount, setQuoteAmount] = useState(285);

  async function bootstrapDemo() {
    setBusy(true);
    setError("");
    try {
      const data = await vendorFetch("/vendors/demo", { method: "POST" });
      setVendor(data.vendor);
      if (data.apiKey) {
        setApiKey(data.apiKey);
        localStorage.setItem(KEY_STORAGE, data.apiKey);
        setNotice("Demo vendor created. API key saved in this browser.");
      } else {
        setNotice(data.message || "Demo vendor ready. Paste an existing vendor API key to continue.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!apiKey) return;
    setBusy(true);
    setError("");
    try {
      localStorage.setItem(KEY_STORAGE, apiKey);
      const me = await vendorFetch("/vendors/me", { apiKey });
      setVendor(me.vendor);
      const [leadData, quoteData, jobData] = await Promise.all([
        vendorFetch("/vendors/me/leads?limit=50", { apiKey }),
        vendorFetch("/vendors/me/quotes?limit=50", { apiKey }),
        vendorFetch("/vendors/me/jobs?limit=50", { apiKey })
      ]);
      setLeads(leadData.leads || []);
      setQuotes(quoteData.quotes || []);
      setJobs(jobData.jobs || []);
      setNotice(`Loaded ${leadData.count || 0} leads · ${quoteData.count || 0} quotes · ${jobData.count || 0} jobs`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (apiKey) refresh();
  }, []);

  useEffect(() => {
    if (!initialLeadId || !leads.length) return;
    const match = leads.find(lead => lead.id === initialLeadId);
    if (match) setSelectedLead(match);
  }, [initialLeadId, leads]);

  async function importHunt() {
    setBusy(true);
    setError("");
    try {
      const data = await vendorFetch("/vendors/me/leads/import-hunt", {
        apiKey,
        method: "POST",
        body: { category: vendor?.defaultCategory || "landscape", segment: "b2b", limit: 20 }
      });
      setNotice(`Imported ${data.imported} leads from hunt files`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runRealAutopilot() {
    setBusy(true);
    setError("");
    try {
      const data = await vendorFetch("/vendors/me/autopilot/run", {
        apiKey,
        method: "POST",
        body: {
          category: vendor?.defaultCategory || "landscape",
          segment: "b2b",
          limit: 4,
          quoteLimit: 2,
          send: true,
          skipCostGate: true,
          includeTransportPack: vendor?.defaultCategory === "transportation"
        }
      });
      setNotice(data.message || `Autopilot imported ${data.imported?.count || 0} leads and created ${data.quoted?.length || 0} quotes`);
      await refresh();
      if (data.imported?.leadIds?.[0]) {
        const match = (await vendorFetch("/vendors/me/leads?limit=50", { apiKey })).leads
          ?.find(lead => lead.id === data.imported.leadIds[0]);
        if (match) setSelectedLead(match);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!selectedLead || !note.trim()) return;
    setBusy(true);
    try {
      await vendorFetch(`/vendors/me/leads/${selectedLead.id}/notes`, {
        apiKey, method: "POST", body: { text: note, author: "ops" }
      });
      setNote("");
      await refresh();
      const updated = (await vendorFetch(`/vendors/me/leads/${selectedLead.id}`, { apiKey }));
      setSelectedLead(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    if (!selectedLead) return;
    setBusy(true);
    try {
      const updated = await vendorFetch(`/vendors/me/leads/${selectedLead.id}/assign`, {
        apiKey, method: "POST", body: { assignee }
      });
      setSelectedLead(updated);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createAndSendQuote() {
    if (!selectedLead) return;
    setBusy(true);
    try {
      const quote = await vendorFetch(`/vendors/me/leads/${selectedLead.id}/quotes`, {
        apiKey,
        method: "POST",
        body: {
          amount: Number(quoteAmount),
          serviceName: selectedLead.payload?.suggestedService?.serviceName || "Service visit",
          category: selectedLead.category
        }
      });
      const sent = await vendorFetch(`/vendors/me/quotes/${quote.id}/send`, {
        apiKey, method: "POST", body: {}
      });
      setNotice(`Quote sent · ${sent.link || sent.quote?.publicPath}`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vendor-ops">
      <div className="card vendor-hero">
        <div>
          <p className="eyebrow">VENDOR MVP</p>
          <h2>Tenant CRM · quotes · jobs</h2>
          <p>Per-vendor API keys, JSON CRM store, lead pipeline, quote lifecycle, and jobs. Public booking at <code>/book/{vendor?.slug || "demo-landscape"}</code>.</p>
        </div>
        <div className="vendor-auth">
          <label className="field compact">
            <span>Vendor API key</span>
            <input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="vcorr_..."
            />
          </label>
          <div className="vendor-actions">
            <button className="ghost" type="button" onClick={bootstrapDemo} disabled={busy}>
              <KeyRound size={16} /> Demo vendor
            </button>
            <button className="primary" type="button" onClick={refresh} disabled={busy || !apiKey}>
              {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {vendor && (
        <div className="vendor-meta card">
          <div>
            <strong>{vendor.name}</strong>
            <small>{vendor.slug} · {vendor.defaultCategory}</small>
          </div>
          <a className="ghost" href={`/book/${vendor.slug}`} target="_blank" rel="noreferrer">
            <Link2 size={16} /> Open booking page
          </a>
          <button className="ghost" type="button" onClick={importHunt} disabled={busy}>
            <Plus size={16} /> Import hunt leads
          </button>
          <button className="primary" type="button" onClick={runRealAutopilot} disabled={busy || !apiKey}>
            <Briefcase size={16} /> Run real autopilot
          </button>
        </div>
      )}

      <div className="vendor-grid">
        <div className="card">
          <div className="panel-head">
            <h3>Leads</h3>
            <small>{leads.length}</small>
          </div>
          <div className="vendor-table">
            {leads.map(lead => (
              <button
                type="button"
                key={lead.id}
                className={`vendor-row ${selectedLead?.id === lead.id ? "active" : ""}`}
                onClick={() => setSelectedLead(lead)}
              >
                <strong>{lead.name}</strong>
                <span>{lead.status}</span>
                <small>{lead.city || "—"} · {lead.assignee || "unassigned"}</small>
              </button>
            ))}
            {!leads.length && <p className="muted">No leads yet. Import hunt leads or take a public booking.</p>}
          </div>
        </div>

        <div className="card">
          <div className="panel-head">
            <h3>Lead detail</h3>
          </div>
          {!selectedLead ? (
            <p className="muted">Select a lead to assign, note, and quote.</p>
          ) : (
            <div className="lead-detail">
              <strong>{selectedLead.name}</strong>
              <p>{selectedLead.phone || "no phone"} · {selectedLead.email || "no email"}</p>
              <p>{selectedLead.address || "no address"}</p>
              <span className="step">{selectedLead.status}</span>

              <label className="field">
                <span>Assignee</span>
                <div className="inline-actions">
                  <input value={assignee} onChange={e => setAssignee(e.target.value)} />
                  <button className="ghost" type="button" onClick={assign} disabled={busy}>
                    <UserPlus size={16} /> Assign
                  </button>
                </div>
              </label>

              <label className="field">
                <span>Note</span>
                <textarea rows="2" value={note} onChange={e => setNote(e.target.value)} />
              </label>
              <button className="ghost" type="button" onClick={addNote} disabled={busy || !note.trim()}>
                Add note
              </button>

              <label className="field">
                <span>Quote amount (USD)</span>
                <div className="inline-actions">
                  <input type="number" value={quoteAmount} onChange={e => setQuoteAmount(e.target.value)} />
                  <button className="primary" type="button" onClick={createAndSendQuote} disabled={busy}>
                    <Send size={16} /> Create & send
                  </button>
                </div>
              </label>

              {!!selectedLead.notes?.length && (
                <ul className="note-list">
                  {selectedLead.notes.map(item => (
                    <li key={item.id}><strong>{item.author}</strong> {item.text}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="vendor-grid">
        <div className="card">
          <div className="panel-head"><h3>Quotes</h3><Briefcase size={16} /></div>
          <ul className="simple-list">
            {quotes.map(quote => (
              <li key={quote.id}>
                <strong>{quote.customerName || quote.serviceName}</strong>
                <span>${Number(quote.amount).toFixed(0)} · {quote.status}</span>
                <a href={`/book/quote/${quote.publicToken}`} target="_blank" rel="noreferrer">public link</a>
              </li>
            ))}
            {!quotes.length && <li className="muted">No quotes yet</li>}
          </ul>
        </div>
        <div className="card">
          <div className="panel-head"><h3>Jobs</h3></div>
          <ul className="simple-list">
            {jobs.map(job => (
              <li key={job.id}>
                <strong>{job.title}</strong>
                <span>{job.status} · {job.assignee}</span>
                <small>{job.scheduledStart ? new Date(job.scheduledStart).toLocaleString() : "unscheduled"}</small>
              </li>
            ))}
            {!jobs.length && <li className="muted">Jobs appear when quotes are accepted</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
