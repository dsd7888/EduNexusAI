/**
 * Faculty "Delivery Guide" workspace — under development. The route stays
 * accessible (no redirect) so the nav entry has somewhere to point.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Construction, Lightbulb } from "lucide-react";

export default function FacultyDeliveryGuidePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Delivery Guide
          </h1>
          <p className="text-sm text-muted-foreground">
            How can I teach this better? AI-generated delivery tips for making a
            topic land in the classroom.
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
            The Delivery Guide is under development. This feature will suggest
            teaching approaches, analogies, and pacing for any topic in your
            syllabus — check back soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
