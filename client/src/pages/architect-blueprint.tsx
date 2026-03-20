import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, Zap, CheckCircle2, Factory, Brain, Terminal,
  TrendingUp, Users, Code2, Eye, Wrench, FileText, Scale, BarChart3,
  Activity, Wifi, Package, AlertTriangle
} from "lucide-react";

const AGENTS = [
  {
    name: "The Supervisor",
    role: "Orchestrator",
    description: "Manages overall SDLC state and delegates tasks via directed acyclic graph (DAG).",
    model: "Orchestration Engine",
    color: "bg-primary/10 text-primary border-primary/20",
    icon: Users,
  },
  {
    name: "The Analyst",
    role: "Intent Extraction",
    description: "Reads README, dependency graphs, and entry points to reconstruct business logic specification.",
    model: "Gemini 1.5 Pro / Claude 3.5",
    color: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300",
    icon: Brain,
  },
  {
    name: "The Coder",
    role: "Code Generation",
    description: "Generates enterprise-ready code with type hints, structured logging, and defensive programming.",
    model: "DeepSeek V3 / GPT-4o",
    color: "bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300",
    icon: Code2,
  },
  {
    name: "The Auditor",
    role: "Security & Architecture",
    description: "Identifies god objects, spaghetti code, hardcoded credentials, and OWASP vulnerabilities.",
    model: "Security Fine-Tuned",
    color: "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300",
    icon: Shield,
  },
  {
    name: "The QA Tester",
    role: "Functional Verification",
    description: "Generates ruthless boundary, type, and adversarial test suites. Iterates until 100% pass rate.",
    model: "Specialized QA Model",
    color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  {
    name: "The DevOps Agent",
    role: "Containerization & CI/CD",
    description: "Generates Dockerfile, docker-compose.yml, and GitHub Actions workflows with multi-stage builds.",
    model: "Infrastructure LLM",
    color: "bg-orange-500/10 text-orange-700 border-orange-500/20 dark:text-orange-300",
    icon: Wrench,
  },
  {
    name: "The Technical Writer",
    role: "Documentation",
    description: "Produces README, INSTALL, API (OpenAPI/Swagger), and TROUBLESHOOTING docs from the final codebase.",
    model: "Long-Context Model",
    color: "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300",
    icon: FileText,
  },
  {
    name: "The Legal Agent",
    role: "License Compliance",
    description: "Scans all dependencies for viral licenses (GPL) and flags or replaces with MIT/Apache alternatives.",
    model: "Compliance Model",
    color: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:text-yellow-300",
    icon: Scale,
  },
];

interface PlatformStatus {
  totalLeads: number;
  totalRevenue: string;
  soldLeads: number;
  availableLeads: number;
  liquidity: number;
  activeWebSocketConnections: number;
  topVendors: { vendorId: number; name: string; leadCount: number }[];
  ingestedToday: number;
  verificationPassRate: number;
}

function PlatformStatusDashboard() {
  const { data: status, isLoading, error } = useQuery<PlatformStatus>({
    queryKey: ["/api/admin/platform-status"],
    refetchInterval: 10000,
    retry: false,
  });

  if (error) {
    return (
      <Card className="border-amber-200 dark:border-amber-800">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Admin Access Required</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Platform status metrics are available to admin users only.
                Contact your administrator or use the admin panel to elevate your access.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-6">
              <div className="h-8 bg-muted rounded mb-2"></div>
              <div className="h-4 bg-muted rounded w-2/3"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!status) return null;

  const liquidityColor = status.liquidity > 70 ? "text-emerald-600" : status.liquidity > 40 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> Total Leads
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{status.totalLeads.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">All time ingested</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">${parseFloat(status.totalRevenue || "0").toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{status.soldLeads} leads sold</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Liquidity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-bold ${liquidityColor}`}>{status.liquidity}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">{status.availableLeads} available</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5" /> Live Connections
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{status.activeWebSocketConnections}</p>
            <p className="text-xs text-muted-foreground mt-0.5">WebSocket clients</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Ingestion Throughput
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{status.ingestedToday}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Leads ingested today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Verification Pass Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-bold ${status.verificationPassRate > 90 ? "text-emerald-600" : status.verificationPassRate > 70 ? "text-amber-600" : "text-red-600"}`}>
              {status.verificationPassRate}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">TCPA / tri-layer verified</p>
          </CardContent>
        </Card>
      </div>

      {status.topVendors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Vendors by Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {status.topVendors.map((vendor, i) => (
                <div key={vendor.vendorId} className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{vendor.name}</span>
                      <span className="text-xs text-muted-foreground">{vendor.leadCount} leads</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${(vendor.leadCount / (status.topVendors[0]?.leadCount || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ArchitectBlueprint() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8 pb-12">
        <div className="space-y-2">
          <h1 className="text-4xl font-display font-bold tracking-tight">The Autonomous Software Foundry</h1>
          <p className="text-xl text-muted-foreground">
            Platform architecture overview and real-time operational metrics
          </p>
        </div>

        <Tabs defaultValue="status">
          <TabsList>
            <TabsTrigger value="status" className="gap-2">
              <Activity className="h-4 w-4" /> Platform Status
            </TabsTrigger>
            <TabsTrigger value="blueprint" className="gap-2">
              <Brain className="h-4 w-4" /> Architectural Blueprint
            </TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="mt-6">
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Live platform metrics. Refreshes every 10 seconds. Admin access required for full visibility.
              </p>
              <PlatformStatusDashboard />
            </div>
          </TabsContent>

          <TabsContent value="blueprint" className="mt-6">
            <div className="space-y-8">
              {/* Core Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-primary/5 border-primary/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" /> Goal
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">Perfect Code</p>
                    <p className="text-xs text-muted-foreground">Functionally correct & secure</p>
                  </CardContent>
                </Card>
                <Card className="bg-emerald-500/5 border-emerald-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Assurance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">Triple Check</p>
                    <p className="text-xs text-muted-foreground">Static, Functional, Security</p>
                  </CardContent>
                </Card>
                <Card className="bg-blue-500/5 border-blue-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Zap className="h-4 w-4 text-blue-500" /> Method
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">Agentic SDLC</p>
                    <p className="text-xs text-muted-foreground">Zero-Touch Automation</p>
                  </CardContent>
                </Card>
              </div>

              {/* Agent Taxonomy */}
              <section className="space-y-4">
                <h2 className="text-2xl font-display font-bold flex items-center gap-2">
                  <Terminal className="h-6 w-6 text-primary" /> Full Agent Taxonomy
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {AGENTS.map((agent) => {
                    const Icon = agent.icon;
                    return (
                      <Card key={agent.name} className={`border ${agent.color}`}>
                        <CardContent className="pt-5 pb-4">
                          <div className="flex items-start gap-3">
                            <div className={`h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 ${agent.color}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm">{agent.name}</span>
                                <Badge variant="outline" className="text-[10px] py-0">{agent.role}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{agent.description}</p>
                              <p className="text-[10px] mt-1.5 text-muted-foreground font-mono">
                                Model: {agent.model}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>

              {/* Economics */}
              <section className="space-y-4">
                <h2 className="text-2xl font-display font-bold flex items-center gap-2">
                  <BarChart3 className="h-6 w-6 text-primary" /> Unit Economics & ROI
                </h2>
                <Card>
                  <CardContent className="pt-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                            <Users className="h-4 w-4 text-red-600 dark:text-red-400" />
                          </div>
                          <span className="font-bold">Human Engineer</span>
                        </div>
                        <div className="text-3xl font-bold text-red-600 dark:text-red-400">$1,500</div>
                        <p className="text-xs text-muted-foreground">Senior engineer at $150/hr · ~10 hours · Risk: human error</p>
                      </div>
                      <div className="p-5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                            <Brain className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <span className="font-bold">MASMS Agents</span>
                        </div>
                        <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">$10</div>
                        <p className="text-xs text-muted-foreground">~500k tokens ~$5 · E2B sandbox 20 min ~$5 · Zero blind spots</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <TrendingUp className="h-8 w-8 text-primary flex-shrink-0" />
                      <div>
                        <p className="font-bold text-lg">99%+ Cost Reduction</p>
                        <p className="text-xs text-muted-foreground">
                          Two orders of magnitude in savings per modernization job.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
