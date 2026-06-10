// Wave 7 (T5) — Vendor performance scorecard (admin view).
// URL: /admin/vendor-scorecard?vendorId=N
//
// Vendors only see this on their own dashboard via /api/vendors/me/scorecard
// (vendor-key authed); this page is the admin's window into any vendor's
// breakdown for support / vetting.

import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, BarChart3, Search, Inbox } from "lucide-react";
import { useState, useEffect } from "react";
import { PermissionRequired } from "@/components/permission-required";

interface ScorecardRow {
  key: string;
  ingested: number;
  sold: number;
  convRate: number;
  avgMediscore: number;
  disputeRate: number;
  revenueUsd: string;
  pctChange: number | null;
}

interface VendorScorecard {
  vendor?: { id: number; name: string };
  vendorId: number;
  windowDays: number;
  generatedAt: string;
  byType: ScorecardRow[];
  bySource: ScorecardRow[];
  totals: {
    ingested: number;
    sold: number;
    convRate: number;
    revenueUsd: string;
    disputes: number;
    disputeRate: number;
  };
}

function readVendorIdFromQuery(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("vendorId") ?? "";
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Minus className="h-3 w-3 mr-1" /> —
      </Badge>
    );
  }
  const isUp = pct >= 0;
  return (
    <Badge variant="outline" className={isUp ? "text-emerald-600" : "text-rose-600"}>
      {isUp ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
      {(pct * 100).toFixed(1)}%
    </Badge>
  );
}

// Sparkline-ish horizontal bar comparing this row's revenue to the max in
// the dataset. The width is purely visual — keeps the table scannable.
function SparkBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-24 bg-muted rounded overflow-hidden">
      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScorecardTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: ScorecardRow[];
}) {
  const maxRevenue = rows.reduce((m, r) => Math.max(m, Number(r.revenueUsd)), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-10 px-6 border border-dashed rounded-xl bg-muted/20" data-testid="scorecard-row-empty">
            <Inbox className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No leads in the last 30 days.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{title.includes("type") ? "Type" : "Source"}</TableHead>
                <TableHead className="text-right">Ingested</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Conv</TableHead>
                <TableHead className="text-right">Avg MediScore</TableHead>
                <TableHead className="text-right">Dispute</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Δ vs prior 30d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.key} data-testid={`scorecard-row-${r.key}`}>
                  <TableCell className="font-medium">{r.key}</TableCell>
                  <TableCell className="text-right font-mono">{r.ingested}</TableCell>
                  <TableCell className="text-right font-mono">{r.sold}</TableCell>
                  <TableCell className="text-right font-mono">
                    {(r.convRate * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.avgMediscore}</TableCell>
                  <TableCell className="text-right font-mono">
                    {(r.disputeRate * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <div className="flex items-center justify-end gap-2">
                      <SparkBar value={Number(r.revenueUsd)} max={maxRevenue} />
                      <span>${r.revenueUsd}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <PctBadge pct={r.pctChange} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function VendorScorecard() {
  const [vendorId, setVendorId] = useState<string>(() => readVendorIdFromQuery());

  // Keep the URL in sync with the input so the page is shareable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (vendorId) params.set("vendorId", vendorId);
    else params.delete("vendorId");
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [vendorId]);

  const numericId = Number(vendorId);
  const enabled = vendorId !== "" && Number.isFinite(numericId) && numericId > 0;

  const { data, isLoading, error } = useQuery<VendorScorecard>({
    queryKey: [`/api/admin/vendors/${numericId}/scorecard`],
    enabled,
  });

  if (error && (error as Error).message?.startsWith("403:")) {
    return <PermissionRequired description="Vendor scorecards are restricted to platform administrators." />;
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-primary" /> Vendor scorecard
          </h1>
          <p className="text-muted-foreground mt-1">
            Conversion, signal quality, dispute rate, and revenue per lead type / source
            across all buyers on the platform.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose vendor</CardTitle>
            <CardDescription>Enter the numeric vendor id to load their breakdown.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              type="number"
              min={1}
              placeholder="e.g. 42"
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
              data-testid="vendor-id-input"
              className="max-w-xs"
            />
          </CardContent>
        </Card>

        {!enabled ? (
          <Card>
            <CardContent className="py-16 text-center" data-testid="scorecard-no-vendor-selected">
              <div className="inline-flex h-14 w-14 rounded-full bg-muted border items-center justify-center mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">Select a vendor</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Enter a vendor id above and we'll pull their 30-day performance breakdown — ingestion volume, conversion rate, dispute rate, and per-source revenue.
              </p>
            </CardContent>
          </Card>
        ) : isLoading || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Ingested (30d)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.totals.ingested}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Sold (30d)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.totals.sold}</div>
                  <div className="text-xs text-muted-foreground">
                    {(data.totals.convRate * 100).toFixed(1)}% conv
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Revenue (30d)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${data.totals.revenueUsd}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Disputes (30d)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.totals.disputes}</div>
                  <div className="text-xs text-muted-foreground">
                    {(data.totals.disputeRate * 100).toFixed(1)}% of sold
                  </div>
                </CardContent>
              </Card>
            </div>

            <ScorecardTable
              title="Performance by lead type"
              description={`Vendor ${data.vendor?.name ?? `#${data.vendorId}`} — trailing 30 days`}
              rows={data.byType}
            />
            <ScorecardTable
              title="Performance by source"
              description="Same window — grouped by lead source"
              rows={data.bySource}
            />
          </>
        )}
      </div>
    </Layout>
  );
}
