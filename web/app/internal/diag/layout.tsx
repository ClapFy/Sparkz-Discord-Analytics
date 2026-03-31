import type { ReactNode } from "react";

export const metadata = {
  title: "Internal diagnostics",
  robots: { index: false, follow: false },
};

export default function InternalDiagLayout({ children }: { children: ReactNode }) {
  return children;
}
