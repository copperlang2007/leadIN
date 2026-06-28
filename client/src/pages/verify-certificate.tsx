import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldX } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useCanonicalUrl } from "@/hooks/useCanonicalUrl";

interface VerifyResponse {
  valid: boolean;
  reason: string;
}

// Public, unauthenticated page: a buyer or their auditor pastes a lead
// compliance certificate and confirms it was signed by the platform and is
// untampered — no account or trust in the seller required.
export default function VerifyCertificate() {
  useDocumentTitle("Verify certificate");
  // Public, shareable page — buyers land here from a link in a
  // seller's compliance cert. Fixed canonical (no token in the URL;
  // the cert is pasted into the form) keeps utm-tagged shares from
  // fragmenting into duplicate indexed URLs.
  useCanonicalUrl("/verify");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [payload, setPayload] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function verify() {
    setError(null);
    setResult(null);
    setPayload(null);
    let cert: any;
    try {
      cert = JSON.parse(input);
    } catch {
      setError("That isn't valid JSON. Paste the full certificate object.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/compliance/verify", { certificate: cert });
      const data = (await res.json()) as VerifyResponse;
      setResult(data);
      setPayload(cert?.payload ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Verification request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" /> Verify a lead certificate
        </h1>
        <p className="text-muted-foreground mt-1">
          Paste a compliance certificate to confirm it was signed by the platform and has not been
          altered. Verification uses public-key cryptography — you don't need an account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Certificate</CardTitle>
          <CardDescription>Paste the full signed certificate JSON.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={10}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder='{"payload":{...},"alg":"ed25519","signature":"..."}'
            className="font-mono text-xs"
          />
          <Button onClick={verify} disabled={loading || !input.trim()}>
            {loading ? "Verifying…" : "Verify"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.valid ? (
                <>
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                  <Badge>Valid signature</Badge>
                </>
              ) : (
                <>
                  <ShieldX className="h-5 w-5 text-destructive" />
                  <Badge variant="destructive">Not valid: {result.reason}</Badge>
                </>
              )}
            </CardTitle>
          </CardHeader>
          {result.valid && payload && (
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Lead ID</dt>
                <dd>{payload.leadId}</dd>
                <dt className="text-muted-foreground">Decision</dt>
                <dd>{payload.decision}</dd>
                <dt className="text-muted-foreground">State</dt>
                <dd>{payload.state}</dd>
                <dt className="text-muted-foreground">Compliance score</dt>
                <dd>{payload.complianceScore}</dd>
                <dt className="text-muted-foreground">Issued at</dt>
                <dd>{payload.issuedAt}</dd>
                <dt className="text-muted-foreground">Disclosures</dt>
                <dd>
                  {payload.disclosures &&
                    Object.entries(payload.disclosures).map(([k, v]) => (
                      <Badge key={k} variant={v ? "outline" : "destructive"} className="mr-1 mb-1">
                        {k}: {String(v)}
                      </Badge>
                    ))}
                </dd>
              </dl>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
