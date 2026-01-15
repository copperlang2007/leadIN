import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Shield, Zap, CheckCircle2, Factory, Brain, Terminal } from "lucide-react";

export default function ArchitectBlueprint() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8 pb-12">
        <div className="space-y-2">
          <h1 className="text-4xl font-display font-bold tracking-tight">The Autonomous Software Foundry</h1>
          <p className="text-xl text-muted-foreground">
            A Comprehensive Architecture for Zero-Touch, Enterprise-Grade Application Modernization and Verification
          </p>
        </div>

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

        <div className="space-y-6">
          <section className="space-y-4">
            <h2 className="text-2xl font-display font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" /> Intelligence Plane
            </h2>
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <p className="text-muted-foreground leading-relaxed">
                    Transitioning from probabilistic generation to deterministic verification. The "Triple Check" protocol ensures code quality through multiple layers.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 border rounded-lg space-y-2">
                      <Badge variant="outline">Layer 1</Badge>
                      <h4 className="font-bold">Syntactic</h4>
                      <p className="text-xs text-muted-foreground">Linters, Compilers, Static Analysis</p>
                    </div>
                    <div className="p-4 border rounded-lg space-y-2">
                      <Badge variant="outline">Layer 2</Badge>
                      <h4 className="font-bold">Functional</h4>
                      <p className="text-xs text-muted-foreground">Unit & Integration Testing in Sandboxes</p>
                    </div>
                    <div className="p-4 border rounded-lg space-y-2">
                      <Badge variant="outline">Layer 3</Badge>
                      <h4 className="font-bold">Security</h4>
                      <p className="text-xs text-muted-foreground">SAST, DAST, OWASP Audits</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

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
                        <span className="text-orange-600 font-bold">n8n</span>
                      </div>
                      <h3 className="font-bold">Control Plane</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Visual orchestration of complex agentic workflows with recursive feedback loops and persistent memory.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-blue-600/10 flex items-center justify-center">
                        <span className="text-blue-600 font-bold">E2B</span>
                      </div>
                      <h3 className="font-bold">Sandbox Plane</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Secure, ephemeral cloud sandboxes (Firecracker VMs) for executing and validating untrusted AI code.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-display font-bold flex items-center gap-2">
              <Terminal className="h-6 w-6 text-primary" /> Agent Taxonomy
            </h2>
            <Card>
              <CardContent className="pt-6">
                <ScrollArea className="h-[200px] w-full rounded-md border p-4">
                  <div className="space-y-4">
                    <div className="flex justify-between items-start border-b pb-2">
                      <div>
                        <p className="font-bold">The Supervisor</p>
                        <p className="text-xs text-muted-foreground">Orchestrates overall SDLC flow</p>
                      </div>
                      <Badge>Orchestrator</Badge>
                    </div>
                    <div className="flex justify-between items-start border-b pb-2">
                      <div>
                        <p className="font-bold">The Analyst</p>
                        <p className="text-xs text-muted-foreground">Intent extraction and polyglot detection</p>
                      </div>
                      <Badge variant="secondary">Gemini/Claude</Badge>
                    </div>
                    <div className="flex justify-between items-start border-b pb-2">
                      <div>
                        <p className="font-bold">The Coder</p>
                        <p className="text-xs text-muted-foreground">High-performance code generation</p>
                      </div>
                      <Badge variant="secondary">DeepSeek/GPT-4o</Badge>
                    </div>
                    <div className="flex justify-between items-start border-b pb-2">
                      <div>
                        <p className="font-bold">The Auditor</p>
                        <p className="text-xs text-muted-foreground">Security and architectural flaw detection</p>
                      </div>
                      <Badge variant="secondary">Security Fine-Tuned</Badge>
                    </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </Layout>
  );
}
