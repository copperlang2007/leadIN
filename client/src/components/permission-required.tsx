import { Link } from "wouter";
import { ShieldX } from "lucide-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PermissionRequiredProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function PermissionRequired({
  title = "Admin access required",
  description = "You don't have permission to view this page. Please contact your organization owner if you believe this is a mistake.",
  action,
}: PermissionRequiredProps) {
  return (
    <Layout>
      <div className="max-w-md mx-auto py-16">
        <Card>
          <CardHeader className="text-center">
            <div className="h-12 w-12 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-2">
              <ShieldX className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            {action ?? (
              <Link href="/">
                <Button variant="outline">Return to marketplace</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
