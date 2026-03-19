import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Zap, CheckCircle2, Factory, Brain, Terminal,
  TrendingUp, Users, Code2, Eye, Wrench, FileText, Scale, BarChart3
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

const SEMGREP_RULES = [
  { rule: "p/owasp-top-ten", description: "Covers the 10 most critical web vulnerabilities" },
  { rule: "p/secrets", description: "Detects hardcoded API keys and passwords" },
  { rule: "p/ci", description: "Checks for insecure CI/CD pipeline configurations" },
  { rule: "p/python / p/javascript", description: "Language-specific best-practice enforcement" },
];

export default function ArchitectBlueprint() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-10 pb-12">
        <div className="space-y-2">
          <h1 className="text-4xl font-display font-bold tracking-tight">The Autonomous Software Foundry</h1>
          <p className="text-xl text-muted-foreground">
            A Comprehensive Architecture for Zero-Touch, Enterprise-Grade Application Modernization and Verification
          </p>
        </div>

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

        <div className="space-y-8">

          {/* Intelligence Plane */}
          <section className="space-y-4">
            <h2 className="text-2xl font-display font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" /> Intelligence Plane
            </h2>
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <p className="text-muted-foreground leading-relaxed">
                    Transitioning from probabilistic generation to deterministic verification. LLMs predict the next token — they cannot guarantee correctness. The "Triple Check" protocol enforces deterministic quality gates through three independent verification layers.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 border rounded-lg space-y-2 border-blue-200 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/10">
                      <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/25 dark:text-blue-300">Layer 1</Badge>
                      <h4 className="font-bold">Syntactic & Static</h4>
                      <p className="text-xs text-muted-foreground">Linters (ESLint, Flake8), compilers, dependency scanners. Deterministic checks — no runtime required.</p>
                    </div>
                    <div className="p-4 border rounded-lg space-y-2 border-violet-200 dark:border-violet-900 bg-violet-50/30 dark:bg-violet-950/10">
                      <Badge className="bg-violet-500/15 text-violet-700 border-violet-500/25 dark:text-violet-300">Layer 2</Badge>
                      <h4 className="font-bold">Functional & Logic</h4>
                      <p className="text-xs text-muted-foreground">Unit & integration tests in E2B sandboxes. Verifies business logic with boundary, type, and adversarial cases.</p>
                    </div>
                    <div className="p-4 border rounded-lg space-y-2 border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10">
                      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 dark:text-emerald-300">Layer 3</Badge>
                      <h4 className="font-bold">Security & Governance</h4>
                      <p className="text-xs text-muted-foreground">SAST (Semgrep), DAST, OWASP audits, supply chain CVE checks, and license compliance scans.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Execution Plane */}
          <section className="space-y-4">
            <h2 className="text-2xl font-display font-bold flex items-center gap-2">
              <Factory className="h-6 w-6 text-primary" /> Execution Plane
            </h2>
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                        <span className="text-orange-600 font-bold text-xs">n8n</span>
                      </div>
                      <h3 className="font-bold">Control Plane</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Visual orchestration of agentic workflows. Supports recursive "Loop Over Items" and "If/Else" nodes for the feedback loops essential to self-correcting code generation. Self-hosted on a private VPS for enterprise privacy.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-blue-600/10 flex items-center justify-center">
                        <span className="text-blue-600 font-bold text-xs">E2B</span>
                      </div>
                      <h3 className="font-bold">Sandbox Plane</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Ephemeral Firecracker micro-VMs for each code execution. Runs untrusted AI-generated code in complete isolation — a fork bomb or reverse shell is destroyed with the VM. Supports long-running interactive sessions.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Full Agent Taxonomy */}
          <section className="space-y-4">
            <h2 className="text-2xl font-display font-bold flex items-center gap-2">
              <Terminal className="h-6 w-6 text-primary" /> Full Agent Taxonomy
            </h2>
            <p className="text-sm text-muted-foreground -mt-2">
              The Mixture of Agents (MoA) architecture outperforms any single model. Each specialist agent is conditioned with a distinct system prompt and model selection optimized for its role.
            </p>
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

          {/* Economics & ROI */}
          <section className="space-y-4">
            <h2 className="text-2xl font-display font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" /> Unit Economics & ROI
            </h2>
            <Card>
              <CardContent className="pt-6 space-y-6">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Comparing the autonomous Code Factory against human engineering labor reveals two orders of magnitude in cost reduction, with a compounding quality advantage through deterministic verification.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Human Cost */}
                  <div className="p-5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                        <Users className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </div>
                      <span className="font-bold">Human Engineer</span>
                    </div>
                    <div className="text-3xl font-bold text-red-600 dark:text-red-400">$1,500</div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>Senior engineer at <strong className="text-foreground">$150/hr</strong></p>
                      <p>Manual audit, refactor, test: <strong className="text-foreground">~10 hours</strong></p>
                      <p>Risk: human error, fatigue, blind spots</p>
                    </div>
                  </div>

                  {/* Agent Cost */}
                  <div className="p-5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                        <Brain className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <span className="font-bold">MASMS Agents</span>
                    </div>
                    <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">$10</div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>~500k tokens: <strong className="text-foreground">~$5</strong></p>
                      <p>E2B sandbox runtime (20 min): <strong className="text-foreground">~$5</strong></p>
                      <p>Deterministic verification: zero blind spots</p>
                    </div>
                  </div>
                </div>

                {/* ROI Banner */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <TrendingUp className="h-8 w-8 text-primary flex-shrink-0" />
                  <div>
                    <p className="font-bold text-lg">99%+ Cost Reduction</p>
                    <p className="text-xs text-muted-foreground">
                      Two orders of magnitude in savings per modernization job. At 500 legacy repositories, human cost ≈ $750,000 vs. MASMS ≈ $5,000 — with deterministic quality guarantees the human team cannot provide.
                    </p>
                  </div>
                </div>

                {/* Tooling costs */}
                <div>
                  <h4 className="font-semibold text-sm mb-3">Monthly Platform Costs</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground text-xs">
                          <th className="pb-2 font-medium">Component</th>
                          <th className="pb-2 font-medium">Option</th>
                          <th className="pb-2 font-medium text-right">Monthly Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="py-2 font-medium">n8n Orchestration</td>
                          <td className="py-2 text-muted-foreground text-xs">Cloud Starter or self-hosted VPS</td>
                          <td className="py-2 text-right font-mono">$0–$20</td>
                        </tr>
                        <tr>
                          <td className="py-2 font-medium">E2B Sandboxes</td>
                          <td className="py-2 text-muted-foreground text-xs">Usage-based, low volume</td>
                          <td className="py-2 text-right font-mono">&lt;$5</td>
                        </tr>
                        <tr>
                          <td className="py-2 font-medium">LLM API (input)</td>
                          <td className="py-2 text-muted-foreground text-xs">Reading 10k lines of code</td>
                          <td className="py-2 text-right font-mono">~$0.50</td>
                        </tr>
                        <tr>
                          <td className="py-2 font-medium">LLM API (output)</td>
                          <td className="py-2 text-muted-foreground text-xs">Writing enterprise code</td>
                          <td className="py-2 text-right font-mono">$1–$3 / app</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Implementation Appendix */}
          <section className="space-y-4">
            <h2 className="text-2xl font-display font-bold flex items-center gap-2">
              <Eye className="h-6 w-6 text-primary" /> Implementation Appendix
            </h2>

            {/* QA Prompt Strategy */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">QA Agent Prompt Strategy</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  The QA agent must be "ruthless." The system prompt conditions it to write only adversarial tests — never happy-path coverage.
                </p>
                <div className="bg-muted rounded-md p-4 font-mono text-xs space-y-1.5 border">
                  <p className="text-primary font-semibold">// QA Agent System Prompt</p>
                  <p><span className="text-muted-foreground">Role:</span> Lead QA Engineer specializing in breaking software.</p>
                  <p><span className="text-muted-foreground">Directives:</span></p>
                  <p className="pl-4">1. Do NOT write simple "happy path" tests.</p>
                  <p className="pl-4">2. Write tests for BOUNDARIES (max int, empty strings).</p>
                  <p className="pl-4">3. Write tests for TYPES (string → math function).</p>
                  <p className="pl-4">4. Write tests for SECURITY (SQL injection strings).</p>
                  <p className="text-destructive pl-4">5. If the code fails these tests, it is NOT enterprise ready.</p>
                </div>
              </CardContent>
            </Card>

            {/* Semgrep Rules */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Security Scan Configuration (Semgrep)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  The Security Agent runs a Static Application Security Testing (SAST) scan using the following Semgrep rule sets. All must return zero findings before the lead is delivered.
                </p>
                <div className="space-y-2">
                  {SEMGREP_RULES.map((r) => (
                    <div key={r.rule} className="flex items-start gap-3 p-3 rounded border bg-muted/30">
                      <code className="text-xs font-mono font-bold text-primary min-w-[150px] flex-shrink-0">{r.rule}</code>
                      <span className="text-xs text-muted-foreground">{r.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recursive Loop Config */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Recursive Fix Loop Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  When a verification layer fails, the system loops back to the Coder Agent with the failure log as context. A hard cap of 5 iterations prevents infinite billing spirals.
                </p>
                <div className="bg-muted rounded-md p-4 font-mono text-xs space-y-1 border">
                  <p className="text-muted-foreground">// n8n Loop Node Logic</p>
                  <p><span className="text-blue-600 dark:text-blue-400">SET</span> retry_count = 0</p>
                  <p><span className="text-blue-600 dark:text-blue-400">LOOP START</span></p>
                  <p className="pl-4">Execute Code + Tests in E2B Sandbox</p>
                  <p className="pl-4"><span className="text-yellow-600 dark:text-yellow-400">IF</span> error:</p>
                  <p className="pl-8">retry_count++</p>
                  <p className="pl-8"><span className="text-yellow-600 dark:text-yellow-400">IF</span> retry_count {">"} 5:</p>
                  <p className="pl-12 text-destructive">BREAK → Flag "Human Intervention Needed"</p>
                  <p className="pl-8"><span className="text-yellow-600 dark:text-yellow-400">ELSE</span>:</p>
                  <p className="pl-12">Feed stderr → Coder Agent → <span className="text-blue-600 dark:text-blue-400">CONTINUE</span></p>
                  <p className="pl-4"><span className="text-emerald-600 dark:text-emerald-400">IF</span> success:</p>
                  <p className="pl-8 text-emerald-600 dark:text-emerald-400">BREAK → Proceed to Delivery</p>
                </div>
              </CardContent>
            </Card>
          </section>

        </div>
      </div>
    </Layout>
  );
}
