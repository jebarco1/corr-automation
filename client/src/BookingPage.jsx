import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, Send } from "lucide-react";

const API = "/api/v1";

function useBookingRoute() {
  const path = window.location.pathname;
  const quoteMatch = path.match(/^\/book\/quote\/([^/]+)/);
  const slugMatch = path.match(/^\/book\/([^/]+)/);
  if (quoteMatch) return { mode: "quote", token: quoteMatch[1], slug: null };
  if (slugMatch && slugMatch[1] !== "quote") return { mode: "booking", token: null, slug: slugMatch[1] };
  return { mode: "none" };
}

export default function BookingPage() {
  const route = useBookingRoute();
  if (route.mode === "quote") return <QuotePublic token={route.token} />;
  if (route.mode === "booking") return <BookingForm slug={route.slug} />;
  return (
    <div className="card booking-shell">
      <h2>Booking</h2>
      <p>Open a vendor page like <code>/book/demo-landscape</code>.</p>
    </div>
  );
}

function BookingForm({ slug }) {
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    serviceName: "",
    amount: 185,
    createQuote: true,
    sendQuote: true
  });

  useEffect(() => {
    fetch(`${API}/public/${slug}/booking`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setProfile(data);
        const first = data.services?.[0]?.name || "Service visit";
        setForm(prev => ({ ...prev, serviceName: first }));
      })
      .catch(err => setError(err.message));
  }, [slug]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/public/${slug}/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Booking failed");
      setDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="booking-shell">
      <div className="card booking-hero">
        <p className="eyebrow">CUSTOMER BOOKING</p>
        <h1>{profile?.vendor?.name || slug}</h1>
        <p>Request service. We’ll confirm schedule and send a quote.</p>
      </div>

      {error && <div className="error">{error}</div>}

      {done ? (
        <div className="card booking-success">
          <CheckCircle2 size={28} />
          <h2>Request received</h2>
          <p>{done.message}</p>
          <div className="booking-actions">
            {done.quote?.publicToken && (
              <a className="primary" href={`/book/quote/${done.quote.publicToken}`}>
                View quote
              </a>
            )}
            {done.lead?.id && (
              <a
                className="ghost"
                href={`/?tab=vendor&leadId=${encodeURIComponent(done.lead.id)}`}
              >
                Open in Vendor Ops
              </a>
            )}
          </div>
        </div>
      ) : (
        <form className="card booking-form" onSubmit={submit}>
          <label className="field"><span>Name</span>
            <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </label>
          <div className="booking-two">
            <label className="field"><span>Email</span>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="field"><span>Phone</span>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </label>
          </div>
          <label className="field"><span>Service address</span>
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="123 Peachtree St, Atlanta, GA" />
          </label>
          <label className="field"><span>Service</span>
            <select value={form.serviceName} onChange={e => setForm({ ...form, serviceName: e.target.value })}>
              {(profile?.services || [{ name: "Service visit" }]).map(service => (
                <option key={service.id || service.name} value={service.name}>{service.name}</option>
              ))}
            </select>
          </label>
          <label className="field"><span>Estimated quote amount</span>
            <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
            Request booking
          </button>
        </form>
      )}
    </section>
  );
}

function QuotePublic({ token }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(params.get("paid") === "1" ? "Payment received. Thank you!" : "");

  async function load() {
    const response = await fetch(`${API}/public/quotes/${token}`);
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Quote not found");
    setData(json);
  }

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, [token]);

  async function act(path, body = {}) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/public/quotes/${token}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Action failed");
      if (path === "checkout" && json.payment?.checkoutUrl) {
        window.location.href = json.payment.checkoutUrl;
        return;
      }
      setMessage(path === "accept" ? "Quote accepted. Job scheduled." : path === "reject" ? "Quote declined." : "Done");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <div className="card booking-shell"><Loader2 className="spin" /> Loading quote…</div>;
  }

  const quote = data?.quote;
  return (
    <section className="booking-shell">
      <div className="card booking-hero">
        <p className="eyebrow">{data?.vendor?.name || "Quote"}</p>
        <h1>{quote?.serviceName || "Service quote"}</h1>
        <p>{quote?.serviceAddress || "Service details"}</p>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      {quote && (
        <div className="card quote-public">
          <div className="quote-amount">${Number(quote.amount).toFixed(2)}</div>
          <span className={`step ${quote.status === "accepted" || quote.status === "paid" ? "success" : ""}`}>
            {quote.status}
          </span>
          <p>Prepared for {quote.customerName || "customer"}</p>
          <div className="booking-actions">
            {["draft", "sent"].includes(quote.status) && (
              <>
                <button className="primary" disabled={busy} onClick={() => act("accept")}>Accept</button>
                <button className="ghost" disabled={busy} onClick={() => act("reject", { reason: "Not now" })}>Decline</button>
              </>
            )}
            {["sent", "accepted", "draft"].includes(quote.status) && (
              <button className="primary" disabled={busy} onClick={() => act("checkout")}>
                <CreditCard size={16} /> Pay now
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
