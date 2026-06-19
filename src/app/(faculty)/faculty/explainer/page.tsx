/**
 * Faculty "Animated Explainers" workspace — temporarily showing an
 * "Under Development" state while the feature is being built. The route stays
 * accessible (no redirect) and the sidebar nav entry is unchanged.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Construction, PlayCircle } from "lucide-react";

export default function FacultyExplainerPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PlayCircle className="size-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Animated Explainers
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate a short animated explainer for any concept — share the link
            with students before your lecture.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Construction className="size-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold">Coming Soon</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Animated explainers are under development. This feature will generate
            AI-powered visual explainers for any concept — check back soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
