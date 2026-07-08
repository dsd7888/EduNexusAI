import type { ReactNode } from "react";

import { FacultyShell } from "@/components/layout/FacultyShell";
import { SessionTracker } from "@/components/layout/SessionTracker";

interface LayoutProps {
  children: ReactNode;
}

export default function FacultyLayout({ children }: LayoutProps) {
  return (
    <>
      <SessionTracker />
      <FacultyShell>{children}</FacultyShell>
    </>
  );
}
