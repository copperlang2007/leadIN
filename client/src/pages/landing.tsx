import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, TrendingUp, FileCheck, Zap } from "lucide-react";
import heroBg from "@assets/generated_images/abstract_blue_secure_data_network_background.png";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div 
          className="absolute inset-0 z-0" 
          style={{ 
            backgroundImage: `url(${heroBg})`, 
            backgroundSize: 'cover', 
            backgroundPosition: 'center',
            filter: 'brightness(0.4)'
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
              Buy verified Medicare Advantage and Supplement leads with complete provenance tracking, 
              compatibility matching, and authenticity guarantees.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
              <Button 
                size="lg" 
                className="text-lg px-8 py-6 shadow-xl hover:shadow-2xl transition-shadow"
                onClick={() => window.location.href = "/api/login"}
              >
                Get Started
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-lg px-8 py-6 bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
                onClick={() => window.location.href = "/pricing"}
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

      {/* Features Section */}
      <div className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-card border rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-display font-bold mb-3">Chain of Custody</h3>
            <p className="text-muted-foreground leading-relaxed">
              Every lead includes a complete provenance log from consumer interaction to delivery, 
              with TrustedForm certification and TCPA consent proof.
            </p>
          </div>

          <div className="bg-card border rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-display font-bold mb-3">Smart Matching</h3>
            <p className="text-muted-foreground leading-relaxed">
              Our compatibility advisor automatically scores leads based on your licensed states, 
              preferred products, and conversion history.
            </p>
          </div>

          <div className="bg-card border rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-display font-bold mb-3">Spec Comparison</h3>
            <p className="text-muted-foreground leading-relaxed">
              Compare multiple leads side-by-side on key attributes like exclusivity, demographics, 
              and vendor ratings before purchasing.
            </p>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-muted/30 border-y">
        <div className="container mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl font-display font-bold mb-4">Ready to get started?</h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of insurance agents accessing high-quality, verified leads daily.
          </p>
          <Button 
            size="lg" 
            className="text-lg px-8 py-6"
            onClick={() => window.location.href = "/api/login"}
          >
            Sign In with Replit
          </Button>
        </div>
      </div>
    </div>
  );
}
