import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, Building2, ChevronRight, FileText, MessageSquare, Play, Receipt, RotateCcw, Settings2, Sparkles, Wand2, Workflow } from "lucide-react";
import { categories, getCategory } from "./categoryCatalog.js";
import { buildAutoAnswers, defaultMarketArea, formatPriceLabel, getIndustryPrices } from "./industryPrices.js";
import WorkflowsPanel from "./WorkflowsPanel.jsx";
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
  const [category, setCategory] = useState(categories[0]?.category || "");
  const [business, setBusiness] = useState(defaultBusiness);
  const [settings, setSettings] = useState(defaultStart);
  const [session, setSession] = useState(null);
  const [answer, setAnswer] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiPrompt, setAiPrompt] = useState(categories[0]?.prompts?.[0] || "");
  const [assistantMessage, setAssistantMessage] = useState("");
  const [chatLog, setChatLog] = useState([
    {
      role: "assistant",
      text: "Choose a category, review industry-standard prices, then describe the job. Use Auto walkthrough to fill answers with market rates."
    }
  ]);
  const chatEndRef = useRef(null);

  const selected = useMemo(() => getCategory(category), [category]);
  const prices = useMemo(() => getIndustryPrices(category), [category]);
  const current = useMemo(() => session?.nextQuestion, [session]);
  const priceEntries = useMemo(
    () => Object.entries(prices).filter(([key]) => !String(key).startsWith("default")),
    [prices]
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLog, session, assistantMessage]);

  function pushChat(role, text) {
    setChatLog(prev => [...prev, { role, text }]);
  }

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

  function onCategoryChange(nextCategory) {
    setCategory(nextCategory);
    const next = getCategory(nextCategory);
    setAiPrompt(next?.prompts?.[0] || "");
    setInvoice(null);
    setSession(null);
    pushChat("assistant", `Switched to ${next?.label || nextCategory}. Industry-standard pricing for ${defaultMarketArea} is ready. Describe the job or run Auto walkthrough.`);
  }

  function businessWithIndustryPrices() {
    return {
      ...business,
      defaultCrewSize: prices.defaultCrewSize || business.defaultCrewSize,
      unitPrices: {
        ...business.unitPrices,
        hourlyRate: prices.hourlyRate || business.unitPrices.hourlyRate,
        materialCost: prices.materialCost || business.unitPrices.materialCost || 0,
        disposalCost: prices.disposalCost || business.unitPrices.disposalCost || 0
      }
    };
  }

  async function startManual() {
    if (!category) {
      setError("Select a service category to continue.");
      return;
    }
    const message = aiPrompt.trim() || selected.prompts[0];
    pushChat("user", message);
    const data = await request(`${API}/ai/start`, {
      method: "POST",
      body: JSON.stringify({
        category,
        message,
        start: {
          ...settings,
          businessSettings: businessWithIndustryPrices(),
          prefill: {}
        }
      })
    });
    setSession(data.workflow);
    setAssistantMessage(data.assistantMessage);
    setCategory(data.category || category);
    setInvoice(null);
    setAnswer("");
    pushChat("assistant", data.assistantMessage || "Walkthrough started. Answer the next question.");
  }

  async function runAutoWalkthrough() {
    if (!category || !selected) {
      setError("Select a service category to continue.");
      return;
    }
    const message = aiPrompt.trim() || selected.prompts[0];
    const autoAnswers = buildAutoAnswers(selected, message, prices);
    pushChat("user", message);
    pushChat("assistant", `Starting auto walkthrough for ${selected.label} using industry-standard rates (base market: ${defaultMarketArea}).`);

    const pricedBusiness = businessWithIndustryPrices();
    let data = await request(`${API}/ai/start`, {
      method: "POST",
      body: JSON.stringify({
        category,
        message,
        start: {
          ...settings,
          businessSettings: pricedBusiness,
          prefill: {}
        }
      })
    });

    let workflow = data.workflow;
    setSession(workflow);
    setAssistantMessage(data.assistantMessage);
    pushChat("assistant", data.assistantMessage || "Session created.");

    // Auto-answer each question with industry-standard / inferred values.
    let guard = 0;
    while (workflow?.nextQuestion && guard < 40) {
      guard += 1;
      const question = workflow.nextQuestion;
      let value = autoAnswers[question.key];
      if (value === undefined || value === null || value === "") {
        if (question.type === "select") value = question.options?.[0];
        else if (question.type === "number" || question.type === "currency") value = question.example ?? 1;
        else if (question.type === "object") value = autoAnswers.customer;
        else if (question.type === "date") value = autoAnswers.requestedDate;
        else value = question.example || "N/A";
      }

      const display = typeof value === "object" ? JSON.stringify(value) : String(value);
      pushChat("user", `${question.question} → ${display}`);

      data = await request(`${API}/ai/chat`, {
        method: "POST",
        body: JSON.stringify({
          sessionId: workflow.sessionId,
          action: "answer",
          value,
          message: display
        })
      });
      workflow = data.workflow;
      setSession(workflow);
      setAssistantMessage(data.assistantMessage);
      if (data.assistantMessage) pushChat("assistant", data.assistantMessage);
    }

    if (workflow && !workflow.nextQuestion) {
      pushChat("assistant", "Auto walkthrough complete using industry-standard pricing. Review answers, then generate the invoice.");
    }
    setAnswer("");
    setInvoice(null);
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
    pushChat("user", typeof value === "object" ? JSON.stringify(value) : String(value));
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
    if (data.assistantMessage) pushChat("assistant", data.assistantMessage);
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
    pushChat("assistant", data.assistantMessage || `Draft invoice ${data.result?.invoiceNumber} ready.`);
  }

  function reset() {
    setSession(null);
    setInvoice(null);
    setAnswer("");
    setError("");
    setAssistantMessage("");
    setChatLog([
      {
        role: "assistant",
        text: "Walkthrough reset. Choose a category and describe the job, or run Auto walkthrough with industry-standard prices."
      }
    ]);
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
            ["workflow", MessageSquare, "Chat Quote"],
            ["workflows", Workflow, "Workflows"],
            ["settings", Settings2, "Business Setup"],
            ["docs", BookOpen, "Documentation"]
          ].map(([id, Icon, label]) => (
            <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-note">Workflows ask AI for industry-standard rates and update pricing JSON. Chat Quote uses local category prompts. OpenAI runs from server OPENAI_API_KEY.</div>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">MULTI-INDUSTRY OPERATIONS</p>
            <h1>
              {tab === "workflow"
                ? "Chat quote walkthrough"
                : tab === "workflows"
                  ? "Pricing workflows"
                  : tab === "settings"
                    ? "Business pricing setup"
                    : "API documentation"}
            </h1>
          </div>
          {(session || chatLog.length > 1) && tab === "workflow" && (
            <button className="ghost" onClick={reset}>
              <RotateCcw size={16} />
              New quote
            </button>
          )}
        </header>

        {error && <div className="error">{error}</div>}

        {tab === "workflow" && (
          <section className="grid landing">
            <div className="card chat-panel">
              <div className="chat-toolbar">
                <label className="field compact">
                  <span>Category</span>
                  <select value={category} onChange={e => onCategoryChange(e.target.value)}>
                    {categories.map(item => (
                      <option value={item.category} key={item.category}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <div className="toolbar-meta">
                  <span className="step">INDUSTRY RATES</span>
                  <strong>{defaultMarketArea}</strong>
                </div>
              </div>

              {selected && (
                <div className="price-strip">
                  {priceEntries.slice(0, 6).map(([key, value]) => (
                    <div className="price-pill" key={key}>
                      <small>{formatPriceLabel(key)}</small>
                      <strong>{typeof value === "number" ? (String(key).toLowerCase().includes("percent") || String(key).includes("Multiplier") ? value : `$${Number(value).toLocaleString()}`) : String(value)}</strong>
                    </div>
                  ))}
                </div>
              )}

              <div className="chat-window">
                {chatLog.map((item, index) => (
                  <div className={`bubble ${item.role}`} key={`${item.role}-${index}`}>
                    <strong>{item.role === "user" ? "You" : "HA-Corr"}</strong>
                    <p>{item.text}</p>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div className="chat-composer">
                <label className="field">
                  <span>Chat prompt</span>
                  <textarea
                    rows="3"
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    placeholder={selected ? `Example: ${selected.prompts[0]}` : "Describe the job..."}
                  />
                </label>
                {selected && (
                  <div className="prompt-row">
                    {selected.prompts.map(prompt => (
                      <button type="button" className="prompt-chip mini" key={prompt} onClick={() => setAiPrompt(prompt)}>
                        <Sparkles size={14} />
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
                <div className="composer-actions">
                  <button className="ghost" disabled={busy || !category} onClick={startManual}>
                    Start chat <ChevronRight size={16} />
                  </button>
                  <button className="primary" disabled={busy || !category} onClick={runAutoWalkthrough}>
                    <Wand2 size={16} /> Auto walkthrough
                  </button>
                </div>
              </div>
            </div>

            <div className="card side-panel">
              <h3>{selected?.label || "Category"} overview</h3>
              <p>{selected?.description}</p>
              <div className="chips">
                {selected?.apis?.map(api => <span key={api}>{api}</span>)}
              </div>

              {!session && (
                <>
                  <h3>Auto walkthrough uses</h3>
                  <dl className="mini-dl">
                    <div><dt>Market</dt><dd>{defaultMarketArea}</dd></div>
                    <div><dt>Hourly</dt><dd>${prices.hourlyRate || "—"}</dd></div>
                    <div><dt>Default hours</dt><dd>{prices.defaultHours || "—"}</dd></div>
                    <div><dt>Crew</dt><dd>{prices.defaultCrewSize || business.defaultCrewSize}</dd></div>
                  </dl>
                </>
              )}

              {session && (
                <>
                  <div className="progress">
                    <span>{session.categoryLabel}</span>
                    <span>{Math.min(session.progress.currentIndex + 1, session.progress.total)} / {session.progress.total}</span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, (session.progress.currentIndex / Math.max(1, session.progress.total)) * 100)}%` }} />
                  </div>

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
                      <h2>Walkthrough complete</h2>
                      <p>Answers were filled with industry-standard pricing assumptions. Generate the invoice when ready.</p>
                      <button className="primary" onClick={makeInvoice} disabled={busy}>
                        <Receipt size={18} /> Generate detailed invoice
                      </button>
                    </>
                  )}

                  <h3>Collected answers</h3>
                  <pre>{JSON.stringify(session.answers, null, 2)}</pre>
                  <h3>API calculations</h3>
                  <div className="chips">
                    {session.apiResults?.map((item, index) => <span key={index}>{item.endpointType}</span>)}
                  </div>
                </>
              )}
            </div>

            {invoice && <Invoice invoice={invoice} />}
          </section>
        )}

        {tab === "workflows" && <WorkflowsPanel request={request} />}

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
              <p className="save-note">Auto walkthrough overrides hourly/material defaults with the selected category’s industry-standard rates.</p>
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
    <div className="card invoice landing-span">
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
        <h2>Landing chat</h2>
        <code>Category dropdown (local)</code>
        <code>Industry-standard prices (local)</code>
        <code>Auto walkthrough → /api/v1/ai/*</code>
      </div>
      <div className="card">
        <Play />
        <h2>Industry workflow</h2>
        <code>POST /api/v1/&#123;category&#125;/workflows/industry-standards</code>
        <code>Updates data/pricing-standards/*.json</code>
        <pre>{`OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini`}</pre>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
