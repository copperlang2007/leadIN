import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { FileQuestion, Home, MessageSquare } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="text-center max-w-md">
        <div className="inline-flex h-20 w-20 rounded-full bg-muted items-center justify-center mb-6">
          <FileQuestion className="h-10 w-10 text-muted-foreground" />
        </div>
        <h1 className="text-5xl font-display font-bold tracking-tight mb-3">404</h1>
        <h2 className="text-xl font-semibold mb-2">Page not found</h2>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or was moved. Try heading back to the marketplace,
          or let us know if a link sent you here.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button data-testid="not-found-home-cta">
              <Home className="h-4 w-4 mr-2" />
              Back to marketplace
            </Button>
          </Link>
          <a href="mailto:support@leadmarket.app?subject=Broken%20link%20on%20LeadMarket">
            <Button variant="outline" data-testid="not-found-report-cta">
              <MessageSquare className="h-4 w-4 mr-2" />
              Report broken link
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
