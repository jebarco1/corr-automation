import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, Building2, ChevronRight, FileText, Play, Receipt, RotateCcw, Settings2, Sparkles } from "lucide-react";
import { categories, getCategory } from "./categoryCatalog.js";
import "./styles.css";

const API = "/api/v1";
const defaultBusiness = {
  businessName: "HA-Corr Service Company",
  email: "billing@example.com",
  phone: "404-555-0100",
  licenseNumber: "",
  defaultCrewSize: 2,
  unitPrices: { hourlyRate: 95, materialCost: 0, equipmentCost: 0, disposalCost: 0 }
};
const defaultStart = { taxRate: 8.9, discount: 0, currency: "USD", paymentTerms: "Net 15" };

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={e => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
      />
    </label>
  );
}

function App() {
  const [tab, setTab] = useState("workflow");
  const [category, setCategory] = useState("");
  const [business, setBusiness] = useState(defaultBusiness);
  const [settings, setSettings] = useState(defaultStart);
  const [session, setSession] = useState(null);
  const [answer, setAnswer] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [assistantMessage, setAssistantMessage] = useState("");

  const selected = useMemo(() => getCategory(category), [category]);
  const current = useMemo(() => session?.nextQuestion, [session]);

  async function request(url, options = {}) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  function applyPrompt(prompt) {
    setAiPrompt(prompt);
  }

  async function start() {
    if (!category) {
      setError("Select a service category to continue.");
      return;
    }
    const message = aiPrompt.trim() || `Start a ${selected.label} quote using available APIs: ${selected.apis.join(", ")}`;
    const data = await request(`${API}/ai/start`, {
      method: "POST",
      body: JSON.stringify({
        category,
        message,
        start: { ...settings, businessSettings: business, prefill: {} }
      })
    });
    setSession(data.workflow);
    setAssistantMessage(data.assistantMessage);
    setCategory(data.category || category);
    setInvoice(null);
    setAnswer("");
  }

  async function submitAnswer() {
    if (!current) return;
    let value = answer;
    if (current.type === "number" || current.type === "currency") value = Number(answer);
    if (current.type === "object") {
      try {
        value = JSON.parse(answer);
      } catch {
        setError("Enter valid JSON for the customer object.");
        return;
      }
    }
    const data = await request(`${API}/ai/chat`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: session.sessionId,
        action: "answer",
        value,
        message: String(answer)
      })
    });
    setSession(data.workflow);
    setAssistantMessage(data.assistantMessage);
    setAnswer("");
  }

  async function makeInvoice() {
    const data = await request(`${API}/ai/chat`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: session.sessionId,
        action: "invoice",
        invoice: settings
      })
    });
    setInvoice(data.result);
    setAssistantMessage(data.assistantMessage);
    setSession(data.workflow);
  }

  function reset() {
    setSession(null);
    setInvoice(null);
    setAnswer("");
    setError("");
    setAssistantMessage("");
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <Building2 />
          <div>
            <strong>HA-Corr</strong>
            <small>Automation</small>
          </div>
        </div>
        <nav>
          {[
            ["workflow", Play, "Guided Quote"],
            ["settings", Settings2, "Business Setup"],
            ["docs", BookOpen, "Documentation"]
          ].map(([id, Icon, label]) => (
            <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-note">Select a category, use API-based prompts, and quote without configuring client keys in the UI. OpenAI runs from server env.</div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">MULTI-INDUSTRY OPERATIONS</p>
            <h1>{tab === "workflow" ? "Guided quote builder" : tab === "settings" ? "Business pricing setup" : "API documentation"}</h1>
          </div>
          {session && (
            <button className="ghost" onClick={reset}>
              <RotateCcw size={16} />
              New quote
            </button>
          )}
        </header>
        {error && <div className="error">{error}</div>}

        {tab === "workflow" && (
          <section>
            {!session ? (
              <div className="grid two">
                <div className="card hero">
                  <span className="step">STEP 1</span>
                  <h2>Select a service category</h2>
                  <p>Categories and starter prompts load locally from the available automation APIs. No API call is required to begin.</p>

                  <label className="field">
                    <span>Category</span>
                    <select value={category} onChange={e => { setCategory(e.target.value); setAiPrompt(""); }}>
                      <option value="">Choose a category...</option>
                      {categories.map(item => (
                        <option value={item.category} key={item.category}>{item.label}</option>
                      ))}
                    </select>
                  </label>

                  {selected && (
                    <>
                      <p className="save-note">{selected.description}</p>
                      <div className="chips">
                        {selected.apis.map(api => <span key={api}>{api}</span>)}
                      </div>
                      <label className="field">
                        <span>Starter prompts from available APIs</span>
                        <div className="prompt-list">
                          {selected.prompts.map(prompt => (
                            <button type="button" className="prompt-chip" key={prompt} onClick={() => applyPrompt(prompt)}>
                              <Sparkles size={14} />
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </label>
                      <label className="field">
                        <span>Describe the job</span>
                        <textarea
                          rows="4"
                          value={aiPrompt}
                          onChange={e => setAiPrompt(e.target.value)}
                          placeholder={`Example: ${selected.prompts[0]}`}
                        />
                      </label>
                      <details className="question-preview">
                        <summary>Questions this category will ask ({selected.questions.length})</summary>
                        <ol>
                          {selected.questions.map(question => (
                            <li key={question.key}>
                              {question.question}
                              {question.api ? <small> → {question.api}</small> : null}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </>
                  )}

                  <button className="primary" disabled={busy || !category} onClick={start}>
                    Start guided quote <ChevronRight size={18} />
                  </button>
                </div>

                <div className="card summary">
                  <h3>How this works</h3>
                  <dl>
                    <div><dt>1</dt><dd>Pick a category from the local catalog</dd></div>
                    <div><dt>2</dt><dd>Use prompts tied to that category’s APIs</dd></div>
                    <div><dt>3</dt><dd>Answer questions; server uses OPENAI_API_KEY from env</dd></div>
                    <div><dt>4</dt><dd>Generate a detailed invoice when ready</dd></div>
                  </dl>
                  <h3>Business defaults</h3>
                  <dl>
                    <div><dt>Business</dt><dd>{business.businessName}</dd></div>
                    <div><dt>Hourly rate</dt><dd>${business.unitPrices.hourlyRate}</dd></div>
                    <div><dt>Tax</dt><dd>{settings.taxRate}%</dd></div>
                    <div><dt>Terms</dt><dd>{settings.paymentTerms}</dd></div>
                  </dl>
                  <button className="link" onClick={() => setTab("settings")}>Edit pricing and tax settings</button>
                </div>
              </div>
            ) : (
              <div className="grid flow">
                <div className="card">
                  <div className="progress">
                    <span>{session.categoryLabel}</span>
                    <span>{Math.min(session.progress.currentIndex + 1, session.progress.total)} / {session.progress.total}</span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, (session.progress.currentIndex / session.progress.total) * 100)}%` }} />
                  </div>
                  {assistantMessage && (
                    <div className="assistant-message">
                      <strong>AI Assistant</strong>
                      <p>{assistantMessage}</p>
                    </div>
                  )}
                  {current ? (
                    <>
                      <span className="step">NEXT QUESTION</span>
                      <h2>{current.question}</h2>
                      <QuestionInput question={current} value={answer} setValue={setAnswer} />
                      <button className="primary" onClick={submitAnswer} disabled={busy || answer === ""}>
                        Save answer <ChevronRight size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="step success">READY</span>
                      <h2>All required information is collected.</h2>
                      <p>Review the accumulated answers and API calculations, then generate the invoice.</p>
                      <button className="primary" onClick={makeInvoice} disabled={busy}>
                        <Receipt size={18} /> Generate detailed invoice
                      </button>
                    </>
                  )}
                </div>
                <div className="card activity">
                  <h3>Collected information</h3>
                  <pre>{JSON.stringify(session.answers, null, 2)}</pre>
                  <h3>API calculations</h3>
                  <div className="chips">
                    {session.apiResults?.map((item, index) => <span key={index}>{item.endpointType}</span>)}
                  </div>
                </div>
              </div>
            )}
            {invoice && <Invoice invoice={invoice} />}
          </section>
        )}

        {tab === "settings" && (
          <section className="grid two">
            <div className="card">
              <h2>AI configuration</h2>
              <p className="save-note">
                Set <code>OPENAI_API_KEY</code> in the server <code>.env</code>. The UI does not collect OpenAI or client API keys.
              </p>
              <h2>Business identity</h2>
              <Field label="Business name" value={business.businessName} onChange={v => setBusiness({ ...business, businessName: v })} />
              <Field label="Billing email" value={business.email} onChange={v => setBusiness({ ...business, email: v })} />
              <Field label="Phone" value={business.phone} onChange={v => setBusiness({ ...business, phone: v })} />
              <Field label="License number" value={business.licenseNumber} onChange={v => setBusiness({ ...business, licenseNumber: v })} />
            </div>
            <div className="card">
              <h2>Pricing and invoice defaults</h2>
              <Field label="Default hourly rate" type="number" value={business.unitPrices.hourlyRate} onChange={v => setBusiness({ ...business, unitPrices: { ...business.unitPrices, hourlyRate: v } })} />
              <Field label="Default crew size" type="number" value={business.defaultCrewSize} onChange={v => setBusiness({ ...business, defaultCrewSize: v })} />
              <Field label="Tax rate (%)" type="number" value={settings.taxRate} onChange={v => setSettings({ ...settings, taxRate: v })} />
              <Field label="Default discount" type="number" value={settings.discount} onChange={v => setSettings({ ...settings, discount: v })} />
              <Field label="Payment terms" value={settings.paymentTerms} onChange={v => setSettings({ ...settings, paymentTerms: v })} />
              <p className="save-note">These values are passed into every new guided session and invoice.</p>
            </div>
          </section>
        )}

        {tab === "docs" && <Docs />}
      </main>
    </div>
  );
}

function QuestionInput({ question, value, setValue }) {
  if (question.type === "select") {
    return (
      <label className="field">
        <span>Select one</span>
        <select value={value} onChange={e => setValue(e.target.value)}>
          <option value="">Choose...</option>
          {question.options?.map(option => <option key={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  if (question.type === "object") {
    return (
      <label className="field">
        <span>Customer JSON</span>
        <textarea
          rows="7"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={JSON.stringify(question.example || { name: "Customer Name", email: "customer@example.com" }, null, 2)}
        />
      </label>
    );
  }
  return (
    <Field
      label={question.required ? "Required answer" : "Optional answer"}
      type={question.type === "number" || question.type === "currency" ? "number" : question.type === "date" ? "date" : "text"}
      value={value}
      onChange={setValue}
      placeholder={question.example?.toString()}
    />
  );
}

function Invoice({ invoice }) {
  return (
    <div className="card invoice">
      <div className="invoice-head">
        <div>
          <p className="eyebrow">DRAFT INVOICE</p>
          <h2>{invoice.invoiceNumber}</h2>
        </div>
        <div className="total">
          ${invoice.total.toFixed(2)}
          <small>{invoice.currency}</small>
        </div>
      </div>
      <div className="invoice-meta">
        <span>{invoice.customer?.name}</span>
        <span>{invoice.serviceAddress}</span>
        <span>{invoice.paymentTerms}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item, index) => (
            <tr key={index}>
              <td>
                {item.description}
                <small>{item.sourceApi}</small>
              </td>
              <td>{item.quantity} {item.unit}</td>
              <td>${Number(item.unitPrice).toFixed(2)}</td>
              <td>${Number(item.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <span>Subtotal <b>${invoice.subtotal.toFixed(2)}</b></span>
        <span>Discount <b>-${invoice.discount.toFixed(2)}</b></span>
        <span>Tax ({invoice.taxRate}%) <b>${invoice.tax.toFixed(2)}</b></span>
        <strong>Total <b>${invoice.total.toFixed(2)}</b></strong>
      </div>
      <details>
        <summary>Invoice JSON payload</summary>
        <pre>{JSON.stringify(invoice, null, 2)}</pre>
      </details>
    </div>
  );
}

function Docs() {
  return (
    <section className="grid docs">
      <div className="card">
        <BookOpen />
        <h2>Interactive Swagger</h2>
        <p>Browse every endpoint, required field, schema, and sample response.</p>
        <a className="primary anchor" href="/docs" target="_blank" rel="noreferrer">Open Swagger</a>
      </div>
      <div className="card">
        <FileText />
        <h2>UI workflow</h2>
        <code>Home page uses local category catalog</code>
        <code>POST /api/v1/ai/start</code>
        <code>POST /api/v1/ai/chat</code>
        <code>OPENAI_API_KEY from server .env</code>
      </div>
      <div className="card">
        <Play />
        <h2>Env setup</h2>
        <pre>{`OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
# Optional for external API clients:
# CORR_CLIENT_API_KEYS=corr_...`}</pre>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
