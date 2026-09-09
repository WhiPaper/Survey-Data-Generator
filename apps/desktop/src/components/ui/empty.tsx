import type { ReactNode } from "react";

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center">{children}</div>;
}
