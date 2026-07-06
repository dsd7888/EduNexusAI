import type { ReactNode } from "react";

import { FacultyShell } from "@/components/layout/FacultyShell";

interface LayoutProps {
  children: ReactNode;
}

export default function FacultyLayout({ children }: LayoutProps) {
  return <FacultyShell>{children}</FacultyShell>;
}
