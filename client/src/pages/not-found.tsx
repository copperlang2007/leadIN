import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { FileQuestion, Home, MessageSquare } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useNoindex } from "@/hooks/useNoindex";

export default function NotFound() {
  useDocumentTitle("Page not found");
  // SPA 404s return HTTP 200 (the server doesn't know the route is
  // bad), so without this hint Google can index broken URLs under
  // our own domain. noindex tells the crawler to drop the page from
  // its results regardless of how it found the URL.
  useNoindex();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="text-center max-w-md">
        <div className="inline-flex h-20 w-20 rounded-full bg-muted items-center justify-center mb-6">
          <FileQuestion className="h-10 w-10 text-muted-foreground" />
        </div>
        <h1 className="text-5xl font-display font-bold tracking-tight mb-3">404</h1>
        <h2 className="text-xl font-semibold mb-2">Page not found</h2>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or was moved. Try heading back home,
          or let us know if a link sent you here.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            {/* "Back to home" is accurate for both audiences: signed-out
                visitors land on Landing at /, signed-in users land on
                Marketplace. The old "Back to marketplace" label
                misrepresented the destination for guests. */}
            <Button data-testid="not-found-home-cta">
              <Home className="h-4 w-4 mr-2" />
              Back to home
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
