// Public-facing site footer. Used on landing, pricing, and any other
// unauthenticated marketing surfaces. Authenticated routes wrap with
// Layout which has its own sidebar nav.

import { Link } from "wouter";
import { ShieldCheck, Mail } from "lucide-react";

const PRODUCT_LINKS = [
  { label: "Marketplace", href: "/marketplace" },
  { label: "Pricing", href: "/pricing" },
  { label: "Platform overview", href: "/architect" },
  { label: "Blog", href: "/blog" },
];

const COMPANY_LINKS = [
  { label: "About", href: "/about" },
  { label: "Careers", href: "/careers" },
  { label: "Contact", href: "/contact" },
];

const LEGAL_LINKS = [
  { label: "Terms of service", href: "/terms" },
  { label: "Privacy policy", href: "/privacy" },
  { label: "TCPA compliance", href: "/tcpa-compliance" },
  { label: "Cookie policy", href: "/cookies" },
];

export function Footer() {
  return (
    <footer className="border-t bg-muted/30 mt-auto">
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {/* Brand column. Full width on mobile via col-span. */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2 font-display font-bold text-lg mb-3">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-primary-foreground" />
              </div>
              LeadMarket
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              The trusted marketplace for verified Medicare, ACA, and Final Expense leads.
            </p>
            <a
              href="mailto:hello@leadmarket.app"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-3"
              data-testid="footer-contact-email"
            >
              <Mail className="h-3.5 w-3.5" />
              hello@leadmarket.app
            </a>
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Company" links={COMPANY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="border-t pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} LeadMarket. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            TCPA-compliant by design. Every lead carries TrustedForm proof of consent.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-muted-foreground hover:text-foreground transition-colors">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
