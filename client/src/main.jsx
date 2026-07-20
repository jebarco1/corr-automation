import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, Building2, ChevronRight, FileText, Layers, MessageSquare, Play, Receipt, RotateCcw, Sparkles, Wand2, Workflow, Bot, Store } from "lucide-react";
import { categories, getCategory } from "./categoryCatalog.js";
import { buildAutoAnswers, defaultMarketArea, formatPriceLabel, getIndustryPrices } from "./industryPrices.js";
import WorkflowsPanel from "./WorkflowsPanel.jsx";
import AutopilotDemo from "./AutopilotDemo.jsx";
import VendorOps from "./VendorOps.jsx";
import BookingPage from "./BookingPage.jsx";
import ServiceCatalogPage from "./ServiceCatalogPage.jsx";
import BusinessesPage from "./BusinessesPage.jsx";
import "./styles.css";

const API = "/api/v1";
const SELECTED_BUSINESS_KEY = "ha_corr_selected_business_id";
const defaultBusiness = {
  businessId: null,
  businessName: "HA-Corr Service Company",
  email: "billing@example.com",
  phone: "404-555-0100",
  licenseNumber: "",
  defaultCrewSize: 2,
  crews: 0,
  employees: 0,
  categories: [],
  primaryCategory: null,
  unitPrices: { hourlyRate: 95, materialCost: 0, equipmentCost: 0, disposalCost: 0 }
};
const defaultStart = { taxRate: 8.9, discount: 0, currency: "USD", paymentTerms: "Net 15" };

function businessFromTenant(tenant, activeCategory = null) {
  if (!tenant) return defaultBusiness;
  const cat = activeCategory || tenant.primaryCategory || tenant.categories?.[0];
  const catSettings = (tenant.categorySettings || {})[cat] || {};
  const capacity = tenant.capacity || {};
  const baseRate = Number(catSettings.hourlyRate || tenant.unitPrices?.hourlyRate || 95);
  const hourlyRate = Number((baseRate * (capacity.rateMultiplier || 1)).toFixed(2));
  const defaultCrewSize = Number(
    capacity.recommendedCrewSize || catSettings.defaultCrewSize || tenant.defaultCrewSize || 2
  );
  return {
    businessId: tenant.id,
    vendorId: tenant.vendorId || tenant.vendor?.id || null,
    businessName: tenant.name,
    email: tenant.email || "",
    phone: tenant.phone || "",
    licenseNumber: catSettings.licenseNumber || tenant.licenseNumber || "",
    defaultCrewSize,
    crews: tenant.crews || 0,
    employees: tenant.employees || 0,
    categories: tenant.categories || [],
    primaryCategory: tenant.primaryCategory || tenant.categories?.[0] || null,
    activeCategory: cat,
    markets: tenant.markets || [],
    team: tenant.team || null,
    capacity,
    categorySettings: tenant.categorySettings || {},
    unitPrices: {
      materialCost: Number(catSettings.materialCost ?? tenant.unitPrices?.materialCost ?? 0),
      equipmentCost: Number(tenant.unitPrices?.equipmentCost ?? 0),
      disposalCost: Number(catSettings.disposalCost ?? tenant.unitPrices?.disposalCost ?? 0),
      ...(tenant.unitPrices || {}),
      hourlyRate,
      averageJobTotal: Number((hourlyRate * defaultCrewSize * 2).toFixed(2))
    },
    city: tenant.city,
    state: tenant.state,
    bookingPath: tenant.bookingPath || null
  };
}

function settingsFromTenant(tenant) {
  const inv = tenant?.invoiceDefaults || {};
  return {
    taxRate: inv.taxRate ?? defaultStart.taxRate,
    discount: inv.discount ?? defaultStart.discount,
    currency: inv.currency || defaultStart.currency,
    paymentTerms: inv.paymentTerms || defaultStart.paymentTerms
  };
}

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

function readAppQuery() {
  if (typeof window === "undefined") return { tab: "autopilot", leadId: null };
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get("tab") || "autopilot",
    leadId: params.get("leadId") || null
  };
}

function App() {
  const isBookingRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/book");
  const initialQuery = readAppQuery();
  const [tab, setTab] = useState(initialQuery.tab === "settings" ? "businesses" : initialQuery.tab);
  const [focusLeadId, setFocusLeadId] = useState(initialQuery.leadId);
  const [category, setCategory] = useState("");
  const [business, setBusiness] = useState(defaultBusiness);
  const [settings, setSettings] = useState(defaultStart);
  const [activeBusinessId, setActiveBusinessId] = useState(
    () => (typeof window !== "undefined" ? localStorage.getItem(SELECTED_BUSINESS_KEY) : null)
  );
  const [businessHubTab, setBusinessHubTab] = useState("overview");
  const [activeTenant, setActiveTenant] = useState(null);
  const [session, setSession] = useState(null);
  const [answer, setAnswer] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [assistantMessage, setAssistantMessage] = useState("");
  const [aiMeta, setAiMeta] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [chatLog, setChatLog] = useState([
    {
      role: "assistant",
      text: "Choose a category to load its service catalog. Then pick a service, paste the address for parcel details, and I’ll finish the quote."
    }
  ]);
  const [offeredServices, setOfferedServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [parcel, setParcel] = useState(null);
  const [quoteStage, setQuoteStage] = useState(null);
  const [bundlePresets, setBundlePresets] = useState([]);
  const [bundleQuote, setBundleQuote] = useState(null);
  const [transportPack, setTransportPack] = useState(null);
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

  useEffect(() => {
    fetch(`${API}/ai/status`)
      .then(r => r.json())
      .then(setAiStatus)
      .catch(() => setAiStatus({ enabled: false }));
    fetch(`${API}/quotes/bundles`)
      .then(r => r.json())
      .then(data => setBundlePresets(data.presets || []))
      .catch(() => setBundlePresets([]));
    fetch(`${API}/businesses`)
      .then(r => r.json())
      .then(data => {
        const list = data.businesses || [];
        if (!list.length) return;
        const preferred = localStorage.getItem(SELECTED_BUSINESS_KEY);
        const tenant = list.find(item => item.id === preferred) || list[0];
        applyTenantBusiness(tenant);
      })
      .catch(() => {});
  }, []);

  function applyTenantBusiness(tenant, opts = {}) {
    if (!tenant) return;
    setActiveBusinessId(tenant.id);
    setActiveTenant(tenant);
    localStorage.setItem(SELECTED_BUSINESS_KEY, tenant.id);
    const nextCategory = opts.category || category || tenant.primaryCategory;
    setBusiness(businessFromTenant(tenant, nextCategory));
    setSettings(settingsFromTenant(tenant));
    if (opts.category) setCategory(opts.category);
    else if (!category && tenant.primaryCategory) setCategory(tenant.primaryCategory);
  }

  function pushChat(role, text, meta = null) {
    setChatLog(prev => [...prev, { role, text, meta }]);
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

  function applyAssistantPayload(data, { resetInvoice = false } = {}) {
    setAiMeta(data);
    setAssistantMessage(data.reply);
    setQuoteStage(data.stage || null);
    setOfferedServices(data.offeredServices || []);
    setSelectedService(data.selectedService || null);
    setParcel(data.parcel || null);
    if (data.category) setCategory(data.category);
    if (data.workflow) {
      setSession(data.workflow);
      setAnswer("");
    }
    if (resetInvoice) setInvoice(null);
    if (data.invoice || data.result?.invoiceNumber || data.result?.invoiceId) {
      setInvoice(data.invoice || data.result);
    }
    pushChat("assistant", data.reply, {
      mode: data.mode,
      stage: data.stage,
      category: data.categoryLabel || data.category,
      actions: data.suggestedActions,
      nextQuestion: data.nextQuestion || data.workflow?.nextQuestion || null,
      services: data.offeredServices || null,
      parcel: data.parcel || null
    });
  }

  async function onCategoryChange(nextCategory) {
    setCategory(nextCategory);
    setInvoice(null);
    setSession(null);
    setOfferedServices([]);
    setSelectedService(null);
    setParcel(null);
    setQuoteStage(null);
    if (activeTenant && nextCategory) {
      setBusiness(businessFromTenant(activeTenant, nextCategory));
    }
    if (!nextCategory) {
      pushChat("assistant", "Pick a category to load its service catalog JSON, or describe the job for auto-detect.");
      return;
    }
    const next = getCategory(nextCategory);
    const categoryPrices = getIndustryPrices(nextCategory);
    const tenantBusiness = activeTenant
      ? businessFromTenant(activeTenant, nextCategory)
      : business;
    pushChat("user", `Category: ${next?.label || nextCategory}`);
    try {
      const data = await request(`${API}/ai/assistant`, {
        method: "POST",
        body: JSON.stringify({
          message: "start",
          category: nextCategory,
          start: {
            ...settings,
            businessSettings: {
              ...tenantBusiness,
              defaultCrewSize: tenantBusiness.defaultCrewSize || categoryPrices.defaultCrewSize,
              unitPrices: {
                ...categoryPrices,
                ...tenantBusiness.unitPrices,
                hourlyRate: tenantBusiness.unitPrices?.hourlyRate || categoryPrices.hourlyRate,
                materialCost: tenantBusiness.unitPrices?.materialCost ?? categoryPrices.materialCost ?? 0,
                disposalCost: tenantBusiness.unitPrices?.disposalCost ?? categoryPrices.disposalCost ?? 0
              },
              capacity: tenantBusiness.capacity
            }
          }
        })
      });
      applyAssistantPayload(data, { resetInvoice: true });
    } catch {
      // error banner already set by request()
    }
  }

  async function sendChatMessage(overrideMessage) {
    const message = String(overrideMessage ?? aiPrompt).trim();
    if (!message) {
      setError(category ? "Pick a service, paste an address, or type an answer." : "Choose a category or describe the job.");
      return;
    }
    const history = chatLog
      .filter(item => item.role === "user" || item.role === "assistant")
      .slice(-10)
      .map(item => ({ role: item.role, content: item.text }));

    pushChat("user", message);
    setAiPrompt("");

    try {
      const startingNewQuote = /get quote|new quote|start over/i.test(message);
      const data = await request(`${API}/ai/assistant`, {
        method: "POST",
        body: JSON.stringify({
          message,
          category: category || undefined,
          sessionId: startingNewQuote ? undefined : session?.sessionId,
          history,
          start: {
            ...settings,
            businessSettings: businessWithIndustryPrices()
          }
        })
      });
      applyAssistantPayload(data, { resetInvoice: startingNewQuote });
    } catch {
      // error banner already set by request()
    }
  }

  function onComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!busy) sendChatMessage();
    }
  }

  function businessWithIndustryPrices() {
    const tenantBusiness = activeTenant
      ? businessFromTenant(activeTenant, category || activeTenant.primaryCategory)
      : business;
    return {
      ...tenantBusiness,
      defaultCrewSize: tenantBusiness.defaultCrewSize || prices.defaultCrewSize || business.defaultCrewSize,
      unitPrices: {
        ...prices,
        ...tenantBusiness.unitPrices,
        hourlyRate: tenantBusiness.unitPrices?.hourlyRate || prices.hourlyRate || business.unitPrices.hourlyRate,
        materialCost: tenantBusiness.unitPrices?.materialCost ?? prices.materialCost ?? 0,
        disposalCost: tenantBusiness.unitPrices?.disposalCost ?? prices.disposalCost ?? 0
      },
      capacity: tenantBusiness.capacity
    };
  }

  async function startManual() {
    const message = aiPrompt.trim() || selected?.prompts?.[0] || chatLog.filter(i => i.role === "user").at(-1)?.text;
    if (!message) {
      setError("Describe the problem first, then start a guided quote.");
      return;
    }
    pushChat("user", message);
    setAiPrompt("");
    const data = await request(`${API}/ai/start`, {
      method: "POST",
      body: JSON.stringify({
        category: category || undefined,
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
    const message = aiPrompt.trim() || selected?.prompts?.[0] || chatLog.filter(i => i.role === "user").at(-1)?.text;
    if (!message) {
      setError("Describe the problem first, then run Auto fill + invoice.");
      return;
    }

    pushChat("user", message);
    setAiPrompt("");
    pushChat("assistant", "Automating quote: industry rates, Regrid size, and draft invoice…");

    const data = await request(`${API}/ai/assistant`, {
      method: "POST",
      body: JSON.stringify({
        message,
        category: category || undefined,
        autoGenerate: true,
        start: {
          ...settings,
          businessSettings: businessWithIndustryPrices()
        }
      })
    });

    setAiMeta(data);
    setAssistantMessage(data.reply);
    if (data.category) setCategory(data.category);
    if (data.workflow) setSession(data.workflow);
    if (data.invoice || data.result?.invoiceNumber || data.result?.invoiceId) {
      setInvoice(data.invoice || data.result);
    }

    // If the only missing piece is an address, answer it from local auto defaults when possible.
    let workflow = data.workflow;
    if (workflow?.nextQuestion) {
      const categoryDef = getCategory(data.category || category);
      const autoAnswers = buildAutoAnswers(categoryDef, message, getIndustryPrices(data.category || category));
      let guard = 0;
      while (workflow?.nextQuestion && guard < 10) {
        guard += 1;
        const question = workflow.nextQuestion;
        let value = autoAnswers[question.key];
        if (value === undefined || value === null || value === "") {
          if (question.type === "select") value = question.options?.[0];
          else if (question.type === "number" || question.type === "currency") value = question.example ?? 1;
          else if (question.type === "object") value = autoAnswers.customer;
          else if (question.type === "date") value = autoAnswers.requestedDate;
          else value = question.example || autoAnswers.serviceAddress || "123 Peachtree St, Atlanta, GA 30303";
        }
        const display = typeof value === "object" ? JSON.stringify(value) : String(value);
        pushChat("user", `${question.question} → ${display}`);
        const next = await request(`${API}/ai/assistant`, {
          method: "POST",
          body: JSON.stringify({
            message: display,
            sessionId: workflow.sessionId,
            autoGenerate: true,
            start: settings
          })
        });
        workflow = next.workflow;
        setSession(workflow);
        setAssistantMessage(next.reply);
        if (next.reply) pushChat("assistant", next.reply);
        if (next.invoice || next.result?.invoiceNumber) {
          setInvoice(next.invoice || next.result);
          break;
        }
      }
    } else {
      pushChat("assistant", data.reply || "Draft invoice ready.");
    }
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
    if (business.businessId && session?.sessionId) {
      const customer = session.answers?.customer;
      fetch(`${API}/businesses/${business.businessId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `bses_${session.sessionId}`,
          kind: "guided",
          category: session.category || category,
          title: `${session.answers?.serviceType || session.categoryLabel || "Service"} quote`,
          status: "invoiced",
          customerName: typeof customer === "object" ? customer?.name : customer,
          summary: data.result?.invoiceNumber
            ? `Invoice ${data.result.invoiceNumber} · $${Number(data.result.total || 0).toFixed(2)}`
            : "Guided invoice attached",
          payload: { sessionId: session.sessionId, invoiceId: data.result?.invoiceId }
        })
      }).catch(() => {});
    }
  }

  async function ensureVendorKey() {
    let key = localStorage.getItem("ha_corr_vendor_api_key") || "";
    if (key) return key;
    const res = await fetch(`${API}/vendors/demo`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not bootstrap demo vendor");
    if (data.apiKey) {
      localStorage.setItem("ha_corr_vendor_api_key", data.apiKey);
      return data.apiKey;
    }
    throw new Error(data.message || "Paste a vendor API key in Vendor Ops first.");
  }

  async function promoteGuidedToCrm() {
    if (!session?.sessionId || !invoice) return;
    setBusy(true);
    setError("");
    try {
      const apiKey = await ensureVendorKey();
      const res = await fetch(`${API}/vendors/me/sessions/from-guided`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ sessionId: session.sessionId, invoice })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Promote failed");
      setFocusLeadId(data.lead?.id || null);
      setTab("vendor");
      pushChat("assistant", `Saved to Vendor Ops: lead ${data.lead?.name} · quote $${Number(data.quote?.amount || 0).toFixed(2)}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runBundle(bundleId) {
    setBusy(true);
    setError("");
    setBundleQuote(null);
    try {
      const address = parcel?.address || session?.answers?.serviceAddress || "123 Main St, Atlanta, GA 30303";
      const customer = session?.answers?.customer || { name: "Taylor Smith", email: "taylor@example.com" };
      const data = await request(`${API}/quotes/bundle`, {
        method: "POST",
        body: JSON.stringify({
          bundleId,
          shared: { serviceAddress: address, customer, answers: { serviceAddress: address, customer } },
          taxRate: settings.taxRate,
          discount: settings.discount,
          businessSettings: business
        })
      });
      setBundleQuote(data);
      pushChat("assistant", `Bundle quote ready: ${data.label} · $${Number(data.total).toFixed(2)} across ${data.trades?.length || 0} trades.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runTransportPack() {
    setBusy(true);
    setError("");
    try {
      const data = await request(`${API}/transportation/pack`, {
        method: "POST",
        body: JSON.stringify({
          pickupAddress: session?.answers?.pickupAddress || session?.answers?.serviceAddress || "100 Peachtree St, Atlanta, GA 30303",
          dropoffAddress: session?.answers?.dropoffAddress || "500 Ponce De Leon Ave, Atlanta, GA 30308",
          distanceMiles: session?.answers?.distanceMiles || 8,
          volumeCubicFeet: session?.answers?.volumeCubicFeet || 350,
          taxRate: settings.taxRate
        })
      });
      setTransportPack(data);
      pushChat("assistant", `Transport pack ready: load plan + route + fuel · $${Number(data.total).toFixed(2)}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSession(null);
    setInvoice(null);
    setAnswer("");
    setError("");
    setAssistantMessage("");
    setAiMeta(null);
    setAiPrompt("");
    setCategory("");
    setOfferedServices([]);
    setSelectedService(null);
    setParcel(null);
    setQuoteStage(null);
    setChatLog([
      {
        role: "assistant",
        text: "Chat reset. Choose a category to load services from its JSON catalog."
      }
    ]);
  }

  if (isBookingRoute) {
    return (
      <div className="booking-app">
        <BookingPage />
      </div>
    );
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
            ["businesses", Building2, "Businesses"],
            ["autopilot", Bot, "Autopilot"],
            ["workflow", MessageSquare, "AI Chat"],
            ["vendor", Store, "Pipeline"],
            ["services", Layers, "Services"],
            ["workflows", Workflow, "Workflows"],
            ["docs", BookOpen, "Documentation"]
          ].map(([id, Icon, label]) => (
            <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-note">
          Active: {business.businessName}
          {business.crews ? ` · ${business.crews} crews / ${business.employees} employees` : ""}.
          Businesses = company workspace; Pipeline = CRM for the active tenant.
        </div>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">MULTI-INDUSTRY OPERATIONS</p>
            <h1>
              {tab === "autopilot"
                ? "Business autopilot demo"
                : tab === "vendor"
                  ? "Company pipeline"
                  : tab === "workflow"
                    ? "AI service chatbot"
                    : tab === "services"
                      ? "Service catalog"
                      : tab === "workflows"
                        ? "Pricing workflows"
                        : tab === "businesses"
                          ? "Businesses"
                          : "API documentation"}
            </h1>
          </div>
          {(session || chatLog.length > 1) && tab === "workflow" && (
            <button className="ghost" onClick={reset}>
              <RotateCcw size={16} />
              New chat
            </button>
          )}
        </header>

        {error && <div className="error">{error}</div>}

        {tab === "autopilot" && (
          <AutopilotDemo
            onOpenVendor={() => {
              setBusinessHubTab("pipeline");
              setTab("businesses");
            }}
            businessId={activeBusinessId}
            businessName={business.businessName}
            defaultCategory={business.primaryCategory || category}
          />
        )}
        {tab === "vendor" && <VendorOps initialLeadId={focusLeadId} />}
        {tab === "services" && <ServiceCatalogPage />}

        {tab === "workflow" && (
          <section className="grid landing">
            <div className="card chat-panel">
              <div className="chat-toolbar">
                <label className="field compact">
                  <span>Category{business.businessName ? ` · ${business.businessName}` : ""}</span>
                  <select value={category} onChange={e => onCategoryChange(e.target.value)}>
                    <option value="">Select category…</option>
                    {(business.categories?.length
                      ? categories.filter(item => business.categories.includes(item.category))
                      : categories
                    ).map(item => (
                      <option value={item.category} key={item.category}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <div className="toolbar-meta">
                  <span className={`step ${aiStatus?.enabled ? "success" : ""}`}>
                    {aiStatus?.enabled ? `AI ON · ${aiStatus.model || "openai"}` : "AI FALLBACK"}
                  </span>
                  <strong>
                    {business.crews
                      ? `${business.crews} crews · ${business.employees} employees`
                      : defaultMarketArea}
                  </strong>
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
                    <strong>{item.role === "user" ? "You" : "HA-Corr AI"}</strong>
                    <p>{item.text}</p>
                    {item.meta?.mode && (
                      <small className="bubble-meta">
                        {item.meta.mode}{item.meta.category ? ` · ${item.meta.category}` : ""}
                      </small>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="bubble assistant typing">
                    <strong>HA-Corr AI</strong>
                    <p>Thinking…</p>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="chat-composer">
                <label className="field">
                  <span>
                    {quoteStage === "pick-service"
                      ? "Pick a service (number or name)"
                      : quoteStage === "need-address"
                        ? "Paste the service address"
                        : session?.nextQuestion
                          ? "Your answer"
                          : "Describe the job / address"}
                  </span>
                  <textarea
                    rows="3"
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    onKeyDown={onComposerKeyDown}
                    placeholder={
                      quoteStage === "need-address"
                        ? "121 Cascade Way, Coppell, TX 75019"
                        : quoteStage === "pick-service"
                          ? "Example: 1 or Lawn Mowing"
                          : session?.nextQuestion
                            ? (session.nextQuestion.options?.join(", ") || session.nextQuestion.example?.toString() || "Type your answer…")
                            : "Choose a category first, or describe the job"
                    }
                  />
                </label>
                {offeredServices.length > 0 && quoteStage === "pick-service" ? (
                  <div className="prompt-row">
                    {offeredServices.slice(0, 12).map(service => (
                      <button
                        type="button"
                        className="prompt-chip mini"
                        key={service.id}
                        disabled={busy}
                        onClick={() => sendChatMessage(String(service.index))}
                        title={service.description}
                      >
                        {service.index}. {service.name}
                      </button>
                    ))}
                  </div>
                ) : session?.nextQuestion?.options?.length ? (
                  <div className="prompt-row">
                    {session.nextQuestion.options.map(option => (
                      <button type="button" className="prompt-chip mini" key={option} disabled={busy} onClick={() => sendChatMessage(option)}>
                        {option}
                      </button>
                    ))}
                  </div>
                ) : !session ? (
                  <div className="prompt-row">
                    {(selected?.prompts || [
                      "mowing quote for 121 Cascade Way, Coppell, TX 75019",
                      ...categories[0].prompts
                    ]).slice(0, 3).map(prompt => (
                      <button type="button" className="prompt-chip mini" key={prompt} onClick={() => setAiPrompt(prompt)}>
                        <Sparkles size={14} />
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="composer-actions">
                  <button className="primary" disabled={busy || !aiPrompt.trim()} onClick={() => sendChatMessage()}>
                    <MessageSquare size={16} /> {
                      quoteStage === "pick-service" ? "Choose service"
                        : quoteStage === "need-address" ? "Load parcel"
                          : session?.nextQuestion ? "Send answer"
                            : "Continue"
                    }
                  </button>
                  {session && !session.nextQuestion && !invoice && quoteStage !== "pick-service" && (
                    <button className="primary" disabled={busy} onClick={() => sendChatMessage("generate")}>
                      <Receipt size={16} /> Generate quote
                    </button>
                  )}
                  <button className="ghost" disabled={busy} onClick={runAutoWalkthrough}>
                    <Wand2 size={16} /> Auto fill + invoice
                  </button>
                </div>
              </div>
            </div>

            <div className="card side-panel">
              <h3>{selected?.label || "AI quote chatbot"}</h3>
              <p>
                {selected?.description
                  || "Flow: category → services from JSON → parcel by address → quote questions / invoice."}
              </p>
              {quoteStage && (
                <p className="save-note">Stage: <strong>{quoteStage}</strong>{selectedService ? ` · ${selectedService.name}` : ""}</p>
              )}
              {parcel && (
                <>
                  <h3>Parcel information</h3>
                  <dl className="mini-dl">
                    <div><dt>Address</dt><dd>{parcel.address || "—"}</dd></div>
                    <div><dt>Area</dt><dd>{parcel.squareFeet != null ? `${Number(parcel.squareFeet).toLocaleString()} sqft` : (parcel.error || "—")}</dd></div>
                    <div><dt>Acres</dt><dd>{parcel.acres ?? "—"}</dd></div>
                    <div><dt>Building</dt><dd>{parcel.buildingSquareFeet != null ? `${Number(parcel.buildingSquareFeet).toLocaleString()} sqft` : "—"}</dd></div>
                    <div><dt>Parcel ID</dt><dd>{parcel.parcelId || "—"}</dd></div>
                  </dl>
                </>
              )}
              {offeredServices.length > 0 && quoteStage === "pick-service" && (
                <>
                  <h3>Catalog services ({offeredServices.length})</h3>
                  <div className="chips">
                    {offeredServices.slice(0, 16).map(service => (
                      <span key={service.id}>{service.index}. {service.name}</span>
                    ))}
                  </div>
                </>
              )}
              <div className="chips">
                {(selected?.apis || aiMeta?.recommendedApis || []).map(api => <span key={api}>{api}</span>)}
              </div>

              {aiMeta && !session && (
                <>
                  <h3>Last AI response</h3>
                  <dl className="mini-dl">
                    <div><dt>Mode</dt><dd>{aiMeta.mode}</dd></div>
                    <div><dt>Category</dt><dd>{aiMeta.categoryLabel || aiMeta.category || "—"}</dd></div>
                    <div><dt>Hourly</dt><dd>{aiMeta.pricing?.unitPrices?.hourlyRate != null ? `$${aiMeta.pricing.unitPrices.hourlyRate}` : "—"}</dd></div>
                  </dl>
                  <div className="chips">
                    {(aiMeta.suggestedActions || []).map(action => <span key={action}>{action}</span>)}
                  </div>
                </>
              )}

              {!session && selected && (
                <>
                  <h3>Industry rates</h3>
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
                    <span>
                      {(session.progress.askableAnswered ?? session.progress.answered)} /
                      {" "}
                      {(session.progress.askableTotal ?? session.progress.total)} asked
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{
                      width: `${Math.min(100, ((session.progress.askableAnswered ?? session.progress.currentIndex) / Math.max(1, session.progress.askableTotal ?? session.progress.total)) * 100)}%`
                    }} />
                  </div>

                  {current ? (
                    <>
                      <span className="step">ONLY NEED THIS</span>
                      <h2>{current.question}</h2>
                      <p className="save-note">Everything else (rates, hours, materials, property type) is auto-filled.</p>
                      <QuestionInput question={current} value={answer} setValue={setAnswer} />
                      <button className="primary" onClick={submitAnswer} disabled={busy || answer === ""}>
                        Save & continue <ChevronRight size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="step success">{invoice ? "INVOICE READY" : "READY"}</span>
                      <h2>{invoice ? "Draft invoice created" : "Automation complete"}</h2>
                      <p>Industry rates, crew, hours, and Regrid measurements were applied automatically.</p>
                      {!invoice && (
                        <button className="primary" onClick={makeInvoice} disabled={busy}>
                          <Receipt size={18} /> Generate detailed invoice
                        </button>
                      )}
                    </>
                  )}

                  {session.autoFilled?.length ? (
                    <>
                      <h3>Auto-filled</h3>
                      <div className="chips">
                        {session.autoFilled.map(key => <span key={key}>{key}</span>)}
                      </div>
                    </>
                  ) : null}

                  <h3>Collected answers</h3>
                  <pre>{JSON.stringify(session.answers, null, 2)}</pre>
                  <h3>API calculations</h3>
                  <div className="chips">
                    {session.apiResults?.map((item, index) => <span key={index}>{item.endpointType}</span>)}
                  </div>
                </>
              )}
            </div>

            {(invoice || (parcel && selectedService)) && (
              <div className="card quote-result landing-span">
                <div className="panel-head">
                  <h3>Quote result</h3>
                  <span className={`step ${invoice ? "success" : ""}`}>{invoice ? "DRAFT READY" : "IN PROGRESS"}</span>
                </div>
                <dl className="mini-dl">
                  <div><dt>Service</dt><dd>{selectedService?.name || session?.answers?.serviceType || "—"}{selectedService?.id ? ` (${selectedService.id})` : ""}</dd></div>
                  <div><dt>Parcel address</dt><dd>{parcel?.address || session?.answers?.matchedAddress || session?.answers?.serviceAddress || "—"}</dd></div>
                  <div><dt>Measured area</dt><dd>{parcel?.squareFeet != null ? `${Number(parcel.squareFeet).toLocaleString()} sqft` : "—"}</dd></div>
                  <div><dt>Lot size</dt><dd>{
                    parcel?.lotSquareFeet != null
                      ? `${Number(parcel.lotSquareFeet).toLocaleString()} sqft${parcel?.acres != null ? ` (${parcel.acres} acres)` : ""}`
                      : "—"
                  }</dd></div>
                  <div><dt>Parcel ID</dt><dd>{parcel?.parcelId || "—"}</dd></div>
                  {invoice && (
                    <>
                      <div><dt>Quote #</dt><dd>{invoice.invoiceNumber}</dd></div>
                      <div><dt>Total</dt><dd>${Number(invoice.total).toFixed(2)} {invoice.currency}</dd></div>
                    </>
                  )}
                </dl>
                {invoice?.lineItems?.length > 0 && (
                  <>
                    <h3>Line items</h3>
                    <ul className="simple-list">
                      {invoice.lineItems.map((item, index) => (
                        <li key={`${item.description}-${index}`}>
                          <strong>{item.description}</strong>
                          <small>{item.quantity} {item.unit} · {item.sourceApi || "estimate"}</small>
                          <span>${Number(item.amount).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {invoice && session?.sessionId && (
                  <div className="inline-actions wrap" style={{ marginTop: 16 }}>
                    <button className="primary" type="button" disabled={busy} onClick={promoteGuidedToCrm}>
                      <Store size={16} /> Save to Vendor Ops
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="card landing-span">
              <div className="panel-head">
                <h3>Multi-trade bundles</h3>
                <span className="step">QUICK WIN</span>
              </div>
              <p>Combine common trades into one quote (landscape + trash, bakery + delivery, etc.).</p>
              <div className="chips" style={{ marginBottom: 12 }}>
                {bundlePresets.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className="prompt-chip mini"
                    disabled={busy}
                    onClick={() => runBundle(preset.id)}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {category === "transportation" && (
                <button className="ghost" type="button" disabled={busy} onClick={runTransportPack}>
                  Transport pack: load + route + fuel
                </button>
              )}
              {bundleQuote && (
                <dl className="mini-dl">
                  <div><dt>Bundle</dt><dd>{bundleQuote.label}</dd></div>
                  <div><dt>Trades</dt><dd>{bundleQuote.trades?.map(t => t.category).join(" + ")}</dd></div>
                  <div><dt>Total</dt><dd>${Number(bundleQuote.total).toFixed(2)}</dd></div>
                </dl>
              )}
              {transportPack && (
                <dl className="mini-dl">
                  <div><dt>Pack</dt><dd>{transportPack.label}</dd></div>
                  <div><dt>Miles</dt><dd>{transportPack.distanceMiles}</dd></div>
                  <div><dt>Fuel</dt><dd>${Number(transportPack.fuel?.estimatedFuelCost || 0).toFixed(2)}</dd></div>
                  <div><dt>Total</dt><dd>${Number(transportPack.total).toFixed(2)}</dd></div>
                </dl>
              )}
            </div>

            {invoice && <Invoice invoice={invoice} />}
          </section>
        )}

        {tab === "workflows" && <WorkflowsPanel request={request} />}

        {tab === "businesses" && (
          <BusinessesPage
            selectedBusinessId={activeBusinessId}
            initialHubTab={businessHubTab}
            onSelectBusiness={applyTenantBusiness}
            onUseInChat={(tenant, opts = {}) => {
              applyTenantBusiness(tenant, { category: opts.category || tenant.primaryCategory });
              if (opts.category || tenant.primaryCategory) {
                setCategory(opts.category || tenant.primaryCategory);
              }
              setTab("workflow");
              pushChat(
                "assistant",
                opts.session
                  ? `Resuming “${opts.session.title}” for ${tenant.name} (${opts.session.category}). Continue the quote in chat.`
                  : `Using ${tenant.name} (${tenant.crews} crews · ${tenant.employees} employees · ${(tenant.categories || []).join(", ")}). Capacity factor ${tenant.capacity?.rateMultiplier || 1}×. Pick a service to quote.`
              );
            }}
            onOpenAutopilot={(tenant) => {
              applyTenantBusiness(tenant);
              if (tenant.primaryCategory) setCategory(tenant.primaryCategory);
              setTab("autopilot");
            }}
          />
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
        <h2>Home AI chatbot</h2>
        <code>POST /api/v1/ai/assistant</code>
        <code>Type a problem → AI reply</code>
        <code>Auto walkthrough → /api/v1/ai/start</code>
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
