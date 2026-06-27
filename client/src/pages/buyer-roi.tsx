import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, DollarSign, Target, Percent } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

interface RoiMetrics {
  leads: number;
  spend: string;
  conversions: number;
  conversionRate: number;
  cac: string;
  costPerConversion: string;
  revenue: string;
  roi: number;
  avgMediscore: number;
}
interface RoiVendor extends RoiMetrics {
  vendorId: string;
  vendorName: string;
}
interface RoiBand extends RoiMetrics {
  band: string;
}
interface BuyerRoiReport {
  overall: RoiMetrics;
  byVendor: RoiVendor[];
  byScoreBand: RoiBand[];
  computedAt: string;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function roiBadge(roi: number) {
  const variant = roi > 0 ? "default" : roi < 0 ? "destructive" : "outline";
  return <Badge variant={variant as any}>{roi > 0 ? "+" : ""}{(roi * 100).toFixed(0)}%</Badge>;
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-md border bg-card">
      <Icon className="h-5 w-5 text-primary" />
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </div>
    </div>
  );
}

function MetricsRow({ label, m }: { label: string; m: RoiMetrics }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 font-medium">{label}</td>
      <td className="py-2 pr-4 text-right">{m.leads.toLocaleString()}</td>
      <td className="py-2 pr-4 text-right">${m.spend}</td>
      <td className="py-2 pr-4 text-right">${m.cac}</td>
      <td className="py-2 pr-4 text-right">{m.conversions}</td>
      <td className="py-2 pr-4 text-right">{pct(m.conversionRate)}</td>
      <td className="py-2 pr-4 text-right">{m.avgMediscore}</td>
      <td className="py-2 text-right">{roiBadge(m.roi)}</td>
    </tr>
  );
}

export default function BuyerRoi() {
  useDocumentTitle("ROI");
  const [commission, setCommission] = useState(500);

  const { data, isLoading } = useQuery<BuyerRoiReport>({
    queryKey: [`/api/buyer/roi?avgCommission=${commission}`],
  });

  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-primary" /> Return on investment
          </h1>
          <p className="text-muted-foreground mt-1">
            What your lead spend actually returns — cost-per-acquisition, conversion, and ROI by
            vendor and MediScore band. Set your average commission to see payback.
          </p>
        </div>

        <div className="flex items-end gap-3 max-w-xs">
          <div className="flex-1">
            <Label htmlFor="commission">Avg commission per conversion ($)</Label>
            <Input
              id="commission"
              type="number"
              min={0}
              value={commission}
              onChange={e => setCommission(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        {isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Total spend" value={`$${data.overall.spend}`} icon={DollarSign} />
              <Stat label="Cost / acquisition" value={`$${data.overall.cac}`} icon={Target} />
              <Stat label="Conversion rate" value={pct(data.overall.conversionRate)} icon={Percent} />
              <Stat label="ROI" value={`${(data.overall.roi * 100).toFixed(0)}%`} icon={TrendingUp} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>By vendor</CardTitle>
                <CardDescription>Spend the most where payback is highest.</CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase border-b">
                      <th className="py-2 pr-4 text-left">Vendor</th>
                      <th className="py-2 pr-4 text-right">Leads</th>
                      <th className="py-2 pr-4 text-right">Spend</th>
                      <th className="py-2 pr-4 text-right">CAC</th>
                      <th className="py-2 pr-4 text-right">Conv.</th>
                      <th className="py-2 pr-4 text-right">Rate</th>
                      <th className="py-2 pr-4 text-right">Avg score</th>
                      <th className="py-2 text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byVendor.length === 0 ? (
                      <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">No purchases yet.</td></tr>
                    ) : (
                      data.byVendor.map(v => <MetricsRow key={v.vendorId} label={v.vendorName} m={v} />)
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By MediScore band</CardTitle>
                <CardDescription>Which quality tiers actually convert for you.</CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase border-b">
                      <th className="py-2 pr-4 text-left">Score band</th>
                      <th className="py-2 pr-4 text-right">Leads</th>
                      <th className="py-2 pr-4 text-right">Spend</th>
                      <th className="py-2 pr-4 text-right">CAC</th>
                      <th className="py-2 pr-4 text-right">Conv.</th>
                      <th className="py-2 pr-4 text-right">Rate</th>
                      <th className="py-2 pr-4 text-right">Avg score</th>
                      <th className="py-2 text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byScoreBand.map(b => <MetricsRow key={b.band} label={b.band} m={b} />)}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
