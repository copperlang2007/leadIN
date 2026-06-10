import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ShieldCheck,
  TrendingUp,
  FileCheck,
  Zap,
  Phone,
  Filter,
  RefreshCw,
  Star,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Footer } from "@/components/footer";
import heroBg from "@assets/generated_images/abstract_blue_secure_data_network_background.png";

const STATS = [
  { value: "$48M+", label: "Paid out to agents" },
  { value: "1.2M", label: "Verified leads delivered" },
  { value: "98%", label: "TCPA-compliant rate" },
  { value: "4.8/5", label: "Agent satisfaction" },
];

const HOW_IT_WORKS = [
  {
    icon: Filter,
    title: "Filter to your fit",
    body: "Set your licensed states, products, and budget. Smart-match scores every incoming lead against your conversion history.",
  },
  {
    icon: Phone,
    title: "Buy and dial",
    body: "Purchase exclusive or shared leads, then call from the built-in dialer with TCPA-safe windows enforced automatically.",
  },
  {
    icon: RefreshCw,
    title: "Dispute and replace",
    body: "Bad contact info? File a one-click dispute. We auto-issue replacement credits for unreachables.",
  },
];

const DIFFERENTIATORS = [
  {
    icon: ShieldCheck,
    title: "Chain of custody on every lead",
    body: "TrustedForm certification, TCPA consent timestamp, and full provenance log come standard. No shadow brokers, no resold leads.",
  },
  {
    icon: Zap,
    title: "AI persona before you dial",
    body: "Each lead gets an auto-generated buyer profile — pain points, likely objections, opening line. Cuts ramp time by 60%.",
  },
  {
    icon: TrendingUp,
    title: "Vendor scorecards in your hand",
    body: "Every supplier ranked by 30-day conversion rate, dispute rate, and revenue contribution. Stop buying blind.",
  },
  {
    icon: FileCheck,
    title: "Dispute-then-replace, not dispute-then-argue",
    body: "Bad-contact and duplicate leads auto-trigger replacement credits — no admin queue, no waiting on a case manager.",
  },
];

const FAQ = [
  {
    q: "What kinds of insurance leads can I buy?",
    a: "Medicare Advantage, Medicare Supplement, ACA, Final Expense, Term Life, Mortgage Protection, Auto, Home, Annuity, and Commercial. Per-lead and subscription pricing modes for each vertical.",
  },
  {
    q: "How do I know the leads are TCPA-compliant?",
    a: "Every lead carries a TrustedForm certificate and a server-verified consent timestamp. We re-check the DNC registry at dial time — if the number got registered after ingest, the dialer blocks the call and we credit you back.",
  },
  {
    q: "What if a lead's contact info is bad?",
    a: "File a one-click dispute from the lead detail page. Bad-contact disputes are auto-approved on high-confidence cases and replacement credits land in your wallet within an hour.",
  },
  {
    q: "Can I bring my own CRM?",
    a: "Yes. Native bidirectional sync for HubSpot, Salesforce, GoHighLevel, and Pipedrive. Or pull leads via our vendor API.",
  },
  {
    q: "Is there a contract or commitment?",
    a: "No. Per-lead pricing is true pay-as-you-go. Subscription plans (Starter / Growth / Scale) cancel any time from the billing settings page.",
  },
  {
    q: "How fast can I start dialing?",
    a: "Sign up, complete NIPR license verification (auto-checked against the state DOI registries), top up your wallet, and your first lead appears in the marketplace within minutes.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${heroBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "brightness(0.4)",
          }}
        />

        <div className="relative z-10 container mx-auto px-6 py-24 lg:py-32">
          <div className="flex items-center justify-center mb-6">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-primary-foreground" />
            </div>
          </div>

          <div className="max-w-3xl mx-auto text-center text-white">
            <h1 className="text-5xl md:text-6xl font-display font-bold mb-6 tracking-tight">
              The Trusted Marketplace for <span className="text-primary">Insurance Leads</span>
            </h1>
            <p className="text-xl md:text-2xl text-white/90 mb-8 leading-relaxed">
              Buy verified Medicare, ACA, and Final Expense leads with full provenance,
              smart-match scoring, and replacement credits when contact info doesn't pan out.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
              <Button
                size="lg"
                className="text-lg px-8 py-6 shadow-xl hover:shadow-2xl transition-shadow"
                onClick={() => (window.location.href = "/api/login")}
                data-track-cta="landing-get-started-hero"
              >
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-lg px-8 py-6 bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
                onClick={() => (window.location.href = "/pricing")}
                data-track-cta="landing-see-pricing"
              >
                See Pricing
              </Button>
            </div>

            <div className="flex flex-wrap gap-4 justify-center">
              <Badge className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 border-emerald-500/50 backdrop-blur-sm px-4 py-2 text-sm">
                <ShieldCheck className="h-4 w-4 mr-2" /> TCPA Compliant
              </Badge>
              <Badge className="bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 border-blue-500/50 backdrop-blur-sm px-4 py-2 text-sm">
                <FileCheck className="h-4 w-4 mr-2" /> TrustedForm Verified
              </Badge>
              <Badge className="bg-violet-500/20 text-violet-100 hover:bg-violet-500/30 border-violet-500/50 backdrop-blur-sm px-4 py-2 text-sm">
                <TrendingUp className="h-4 w-4 mr-2" /> 98% Contact Rate
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="border-y bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl md:text-4xl font-display font-bold text-primary mb-1">{s.value}</div>
                <div className="text-sm text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="container mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4">How it works</Badge>
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-3">
            From signup to first call in minutes
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No demos, no sales calls. Just connect your license, fund your wallet, and start buying.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {HOW_IT_WORKS.map((step, i) => (
            <div key={step.title} className="relative bg-card border rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow">
              <div className="absolute -top-4 left-8 h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
                {i + 1}
              </div>
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 mt-2">
                <step.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-display font-bold mb-3">{step.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Differentiators */}
      <div className="bg-muted/30 border-y">
        <div className="container mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Why agents choose us</Badge>
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-3">
              Built for closers, not lead brokers
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Every feature exists because an agent asked for it. No vanity dashboards, no bait-and-switch pricing.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.title} className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex gap-4">
                <div className="shrink-0 h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <d.icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold mb-2">{d.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{d.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Testimonial */}
      <div className="container mx-auto px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
            ))}
          </div>
          <blockquote className="text-2xl md:text-3xl font-display font-medium leading-relaxed mb-6">
            "Switched from a major lead vendor and our contact rate went from 41% to 89% in the first
            month. The dispute flow alone has saved me 12 hours a week."
          </blockquote>
          <div className="flex items-center justify-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
              MR
            </div>
            <div className="text-left">
              <div className="font-semibold">Maria Rodriguez</div>
              <div className="text-sm text-muted-foreground">Independent Medicare Agent, Florida</div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="bg-muted/30 border-y">
        <div className="container mx-auto px-6 py-20">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <Badge variant="outline" className="mb-4">FAQ</Badge>
              <h2 className="text-3xl md:text-4xl font-display font-bold">Questions agents actually ask</h2>
            </div>
            <Accordion type="single" collapsible className="space-y-3">
              {FAQ.map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`item-${i}`}
                  className="bg-card border rounded-xl px-6"
                >
                  <AccordionTrigger className="text-left font-display font-semibold hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div className="container mx-auto px-6 py-20">
        <div className="max-w-3xl mx-auto text-center bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border rounded-2xl p-12">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
            Start with $25 in free credits
          </h2>
          <p className="text-lg text-muted-foreground mb-3 max-w-xl mx-auto">
            New agents get $25 to test the marketplace. Buy a lead, dial it, see for yourself.
            No card required to sign up.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-8 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> No contracts</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> No setup fees</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Cancel anytime</span>
          </div>
          <Button
            size="lg"
            className="text-lg px-8 py-6"
            onClick={() => (window.location.href = "/api/login")}
            data-track-cta="landing-get-started-footer"
          >
            Get Started Free
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </div>

      <Footer />
    </div>
  );
}
