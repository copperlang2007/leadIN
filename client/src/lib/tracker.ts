// Lightweight behavioral-event SDK.
// Captures page views, scroll depth milestones (25/50/75/100%), dwell time,
// CTA clicks (anything with data-track-cta or class .cta-track), and tool
// interactions (data-track-tool). Events ship to /api/events/track via a
// keepalive fetch so they survive navigation.

type EventType = "page_view" | "scroll_depth" | "time_on_page" | "tool_interaction" | "cta_click";

interface QueuedEvent {
  sessionId: string;
  leadId?: number;
  eventType: EventType;
  path?: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

const SESSION_KEY = "lm_session_id";
const ENDPOINT = "/api/events/track";

function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s_${Math.random().toString(36).slice(2, 18)}`;
  }
}

function postEvent(e: QueuedEvent) {
  try {
    // Attach the active lead id if the SDK consumer has set one (e.g. when a
    // lead detail dialog is open). This is what links behavioral signals
    // back to a specific lead so MediScore can fold them in.
    const payload = { leadId: activeLeadId, ...e };
    const body = JSON.stringify(payload);
    fetch(ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function setTrackerLeadId(leadId: number | undefined): void {
  activeLeadId = leadId;
}

let pageEnteredAt = Date.now();
let lastPath = "";
let firedScrollMilestones = new Set<number>();
let dwellPosted = false;
let activeLeadId: number | undefined;

function trackPageView() {
  const path = window.location.pathname + window.location.search;
  if (path === lastPath) return;
  // Flush dwell on the previous page first
  flushDwell();
  lastPath = path;
  pageEnteredAt = Date.now();
  firedScrollMilestones = new Set();
  dwellPosted = false;
  postEvent({
    sessionId: getSessionId(),
    eventType: "page_view",
    path,
  });
}

function trackScroll() {
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (docHeight <= 0) return;
  const percent = Math.min(100, Math.round((window.scrollY / docHeight) * 100));
  for (const milestone of [25, 50, 75, 100]) {
    if (percent >= milestone && !firedScrollMilestones.has(milestone)) {
      firedScrollMilestones.add(milestone);
      postEvent({
        sessionId: getSessionId(),
        eventType: "scroll_depth",
        path: window.location.pathname,
        value: milestone,
      });
    }
  }
}

function flushDwell() {
  if (dwellPosted) return;
  const seconds = Math.round((Date.now() - pageEnteredAt) / 1000);
  if (seconds < 2) return;
  dwellPosted = true;
  postEvent({
    sessionId: getSessionId(),
    eventType: "time_on_page",
    path: lastPath || window.location.pathname,
    value: seconds,
  });
}

function findTrackedAncestor(start: EventTarget | null): HTMLElement | null {
  let el = start as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.dataset?.trackCta || el.dataset?.trackTool || el.classList?.contains("cta-track")) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function onDocumentClick(ev: MouseEvent) {
  const target = findTrackedAncestor(ev.target);
  if (!target) return;
  const isTool = !!target.dataset.trackTool;
  postEvent({
    sessionId: getSessionId(),
    eventType: isTool ? "tool_interaction" : "cta_click",
    path: window.location.pathname,
    metadata: {
      label: target.dataset.trackCta || target.dataset.trackTool || target.textContent?.trim().slice(0, 80),
    },
  });
}

let installed = false;

export function installTracker(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  trackPageView();

  // Patch wouter / history navigations
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args: any[]) {
    const r = origPush.apply(this, args as any);
    setTimeout(trackPageView, 0);
    return r;
  };
  history.replaceState = function (...args: any[]) {
    const r = origReplace.apply(this, args as any);
    setTimeout(trackPageView, 0);
    return r;
  };
  window.addEventListener("popstate", trackPageView);

  // Scroll milestones (throttled with rAF)
  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      trackScroll();
      scrollTicking = false;
    });
  }, { passive: true });

  document.addEventListener("click", onDocumentClick, true);

  // Flush dwell on tab hide / unload
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDwell();
  });
  window.addEventListener("beforeunload", flushDwell);
}

// Manual hook for typed component-level events
export function trackEvent(eventType: EventType, opts: Partial<QueuedEvent> = {}): void {
  postEvent({
    sessionId: getSessionId(),
    eventType,
    path: window.location.pathname,
    ...opts,
  });
}

export function getTrackerSessionId(): string {
  return getSessionId();
}
