// Shared chrome for the public legal pages (Privacy, Terms, Cookies).
// Keeps them visually consistent, gives every page the same
// "last updated" affordance and the same compliance disclaimer at the
// top so operators rolling out a deploy don't accidentally ship the
// template as if it were their final policy.

import { Link } from "wouter";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { Footer } from "@/components/footer";

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Minimal top bar — just the brand. Public pages don't get the
          authenticated sidebar nav. print:hidden so a counsel-shared
          PDF doesn't waste the first inch of paper on nav links the
          recipient can't click anyway. */}
      <header className="border-b print:hidden">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 font-display font-bold text-lg">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            LeadMarket
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link href="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <article className="container mx-auto max-w-3xl px-6 py-12 print:py-0 print:max-w-none">
          <header className="mb-8">
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">{title}</h1>
            <p className="text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
          </header>

          {/* Operator disclaimer — visible BEFORE the body. The text below
              this banner is a generic starting template; the operator's
              counsel must review and replace it with the version applicable
              to their jurisdiction + business model before going live.
              print:hidden so the banner doesn't appear on a counsel-
              reviewed PDF — at that point the operator has already
              addressed the concern. */}
          <div className="mb-10 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 flex items-start gap-3 print:hidden">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" />
            <p className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed">
              <span className="font-semibold">Operator notice — template policy.</span>{" "}
              This document is a structural template to make the public footer
              functional for Stripe live mode and basic GTM credibility. Have
              counsel review and customise the substantive clauses (especially
              data handling, governing law, dispute resolution, and the
              jurisdiction-specific consumer rights sections) before relying
              on it. Remove this banner once that review is complete.
            </p>
          </div>

          <div className="prose-styles space-y-6 text-sm leading-relaxed">
            {children}
          </div>

          <div className="mt-12 pt-6 border-t text-xs text-muted-foreground">
            Questions about this policy? Email{" "}
            <a href="mailto:legal@leadmarket.app" className="text-primary hover:underline">
              legal@leadmarket.app
            </a>
            .
          </div>
        </article>
      </main>

      {/* Footer carries product nav + brand info — fine on the web,
          noise on a printed legal doc that's meant to be a standalone
          policy artifact. */}
      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}

// Section heading helper — picks consistent sizing across all three pages.
export function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-xl font-display font-semibold mt-8 mb-3 scroll-mt-24">
      {children}
    </h2>
  );
}

// Definition list row — used by Cookies + Privacy for "X means …" lists.
export function DLRow({ term, def }: { term: string; def: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-1 md:gap-4 py-2 border-b last:border-b-0">
      <dt className="font-semibold text-foreground">{term}</dt>
      <dd className="text-muted-foreground">{def}</dd>
    </div>
  );
}
