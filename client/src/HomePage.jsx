import React from "react";
import {
  BookOpen,
  Bot,
  Building2,
  ChevronRight,
  ExternalLink,
  Layers,
  MessageSquare,
  Store,
  Workflow
} from "lucide-react";

const FEATURES = [
  {
    id: "businesses",
    icon: Building2,
    title: "Businesses",
    blurb: "Company workspace — teams, markets, sessions, and CRM pipeline."
  },
  {
    id: "autopilot",
    icon: Bot,
    title: "Autopilot",
    blurb: "Hunt leads, quote, and run the live CRM autopilot loop."
  },
  {
    id: "workflow",
    icon: MessageSquare,
    title: "AI Chat",
    blurb: "Guided multi-trade quoting with parcel data and invoices."
  },
  {
    id: "vendor",
    icon: Store,
    title: "Pipeline",
    blurb: "Tenant CRM — leads, quotes, jobs, and pricebook."
  },
  {
    id: "services",
    icon: Layers,
    title: "Services",
    blurb: "Catalog of trades with inputs, formulas, and AI advisor."
  },
  {
    id: "workflows",
    icon: Workflow,
    title: "Workflows",
    blurb: "Pricing standards refresh and industry workflow runs."
  },
  {
    id: "docs",
    icon: BookOpen,
    title: "Documentation",
    blurb: "API paths, versioning, and how the product pieces fit."
  }
];

const EXTERNAL = [
  { href: "/docs", label: "Swagger API docs", detail: "/docs" },
  { href: "/book/demo-landscape", label: "Public booking", detail: "/book/demo-landscape" },
  { href: "/openapi.yaml", label: "OpenAPI spec", detail: "/openapi.yaml" },
  { href: "/health", label: "Health check", detail: "/health" }
];

export default function HomePage({
  onOpenFeature,
  businessName = null,
  bookingPath = "/book/demo-landscape"
}) {
  const externals = [
    ...EXTERNAL.filter(item => item.href !== "/book/demo-landscape"),
    { href: bookingPath || "/book/demo-landscape", label: "Public booking", detail: bookingPath || "/book/demo-landscape" }
  ];

  return (
    <section className="home-page">
      <div className="home-hero">
        <p className="eyebrow">HA-CORR AUTOMATION</p>
        <h2 className="home-brand">HA-Corr</h2>
        <p className="home-lede">
          Multi-trade field service — companies, quoting, autopilot, and CRM in one place.
        </p>
        <div className="home-cta">
          <button className="primary" type="button" onClick={() => onOpenFeature?.("businesses")}>
            <Building2 size={16} />
            Open Businesses
            <ChevronRight size={16} />
          </button>
          <button className="ghost" type="button" onClick={() => onOpenFeature?.("autopilot")}>
            <Bot size={16} />
            Run Autopilot
          </button>
        </div>
        {businessName && (
          <p className="home-active">Active company · {businessName}</p>
        )}
      </div>

      <div className="home-features">
        <div className="panel-head">
          <h3>Available features</h3>
          <small>Jump into any workspace</small>
        </div>
        <div className="home-feature-list" role="list">
          {FEATURES.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="home-feature-link"
                role="listitem"
                onClick={() => onOpenFeature?.(item.id)}
              >
                <span className="home-feature-icon"><Icon size={18} /></span>
                <span className="home-feature-copy">
                  <strong>{item.title}</strong>
                  <small>{item.blurb}</small>
                </span>
                <ChevronRight size={18} className="home-feature-chevron" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="home-external">
        <div className="panel-head">
          <h3>API & public links</h3>
          <small>Open in this browser</small>
        </div>
        <div className="home-link-row">
          {externals.map(item => (
            <a key={item.href} className="home-ext-link" href={item.href} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
