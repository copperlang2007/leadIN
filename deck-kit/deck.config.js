/* Customize this file; the renderer is generic. */
window.DECK = {
  brand: { name: "Lead-Connect-Pro", mark: "LC", accent: "#0d9488", accent2: "#38bdf8" },
  slides: [
    { type: "title", eyebrow: "Lead-Connect-Pro", title: "A one-line hook for <em>Lead-Connect-Pro</em>.", lead: "What Lead-Connect-Pro does and why it matters.", kpis: [{ n: "10x", l: "the measurable win" }], pill: "Replace with the moat" },
    { type: "bullets", eyebrow: "Problem", title: "Why this must exist", bullets: ["Customer pain", { t: "Costly failure mode", tone: "bad" }, "Why now"] },
    { type: "flow", eyebrow: "Product", title: "How it compounds value", nodes: [{ t: "Input", d: "Unique signal" }, { t: "System", d: "Defensible workflow", kind: "key" }, { t: "Outcome", d: "Measurable value" }] },
    { type: "screen", eyebrow: "Proof", title: "See it work", shot: "dashboard", caption: "your-app.example", points: ["User outcome", "Evidence", "Advantage"] },
    { type: "roadmap", title: "Roadmap", columns: [{ when: "Shipped", color: "#5eead4", items: ["…"] }, { when: "Next", color: "#7dd3fc", items: ["…"] }, { when: "Horizon", color: "#c4b5fd", items: ["…"] }] },
    { type: "cta", eyebrow: "Get started", title: "Try Lead-Connect-Pro today.", cmd: ["<b>$</b> # quickstart"], points: ["Step one", "Step two"] }
  ]
};
