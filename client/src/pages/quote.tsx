import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

interface QuoteResult {
  eligible: boolean;
  reasons: string[];
  recommendedPlanTypes: string[];
  enrollmentWindows: string[];
  estimatedIntent: number;
  captured: boolean;
}

const PLAN_OPTIONS = ["Medicare Advantage", "Medigap", "Part D (PDP)"];

// Public lead-magnet page: a consumer gets an instant Medicare plan-match in
// ~60 seconds; with consent we capture a TCPA-attributed lead.
export default function Quote() {
  useDocumentTitle("Find your Medicare plan");
  const [form, setForm] = useState({
    age: "",
    state: "",
    zip: "",
    interest: "",
    currentlyOnMedicare: false,
    lowIncome: false,
    chronicConditions: false,
    name: "",
    phone: "",
    email: "",
    consent: false,
  });
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const utmSource = new URLSearchParams(window.location.search).get("utm_source") ?? undefined;
      const res = await apiRequest("POST", "/api/quote", {
        age: form.age ? Number(form.age) : undefined,
        state: form.state.toUpperCase(),
        zip: form.zip,
        interest: form.interest || undefined,
        currentlyOnMedicare: form.currentlyOnMedicare,
        lowIncome: form.lowIncome,
        chronicConditions: form.chronicConditions,
        name: form.name || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        consent: form.consent,
        utmSource,
      });
      setResult((await res.json()) as QuoteResult);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-primary" /> Find your Medicare plan
        </h1>
        <p className="text-muted-foreground mt-1">
          Answer a few questions to see which plan types fit and which enrollment window is open.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
          <CardDescription>No account needed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="age">Age</Label>
              <Input id="age" type="number" value={form.age} onChange={e => set("age", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" maxLength={2} placeholder="TX" value={form.state} onChange={e => set("state", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="zip">ZIP</Label>
              <Input id="zip" value={form.zip} onChange={e => set("zip", e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="interest">Plan interest (optional)</Label>
            <select
              id="interest"
              className="w-full border rounded-md h-10 px-3 bg-background"
              value={form.interest}
              onChange={e => set("interest", e.target.value)}
            >
              <option value="">Not sure yet</option>
              {PLAN_OPTIONS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.currentlyOnMedicare} onCheckedChange={v => set("currentlyOnMedicare", !!v)} />
              I'm already on Medicare
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.lowIncome} onCheckedChange={v => set("lowIncome", !!v)} />
              I may qualify for Medicaid / extra help
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.chronicConditions} onCheckedChange={v => set("chronicConditions", !!v)} />
              I manage a chronic condition
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={e => set("name", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={e => set("phone", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={form.email} onChange={e => set("email", e.target.value)} />
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox checked={form.consent} onCheckedChange={v => set("consent", !!v)} className="mt-0.5" />
            <span>
              By checking this box I agree to be contacted by a licensed insurance agent at the phone number
              provided, including via autodialer and prerecorded messages (TCPA consent). Consent is not a
              condition of purchase.
            </span>
          </label>

          <Button onClick={submit} disabled={loading || !form.age || form.state.length !== 2 || !form.zip}>
            {loading ? "Checking…" : "See my plan match"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.eligible ? <Badge>Eligible</Badge> : <Badge variant="destructive">Not yet eligible</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {result.recommendedPlanTypes.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1">Recommended plan types</div>
                <div className="flex flex-wrap gap-1">
                  {result.recommendedPlanTypes.map(p => (
                    <Badge key={p} variant="outline">{p}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result.enrollmentWindows.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1">Open enrollment windows</div>
                <div className="flex flex-wrap gap-1">
                  {result.enrollmentWindows.map(w => (
                    <Badge key={w}>{w}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result.captured && (
              <p className="flex items-center gap-2 text-green-600">
                <ShieldCheck className="h-4 w-4" /> A licensed agent will reach out shortly.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
