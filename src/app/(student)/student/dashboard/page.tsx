import { BookOpen, Brain } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";

export default function StudentDashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="text-muted-foreground text-sm">
          Choose how you want to study today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="flex flex-col justify-between transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-start gap-3">
            <div className="mt-1 rounded-md bg-primary/10 p-2 text-primary">
              <BookOpen className="size-5" />
            </div>
            <div>
              <CardTitle>Start Learning</CardTitle>
              <CardDescription>
                Chat with your AI tutor and explore your subjects.
              </CardDescription>
            </div>
          </CardHeader>
          <CardFooter className="px-6 pb-6">
            <Button asChild>
              <Link href="/student/subjects">Select Subject →</Link>
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex flex-col justify-between transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-start gap-3">
            <div className="mt-1 rounded-md bg-primary/10 p-2 text-primary">
              <Brain className="size-5" />
            </div>
            <div>
              <CardTitle>Knowledge Check</CardTitle>
              <CardDescription>
                Test yourself with quizzes and track your progress.
              </CardDescription>
            </div>
          </CardHeader>
          <CardFooter className="px-6 pb-6">
            <Button asChild variant="secondary">
              <Link href="/student/quiz">Take a Quiz →</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
