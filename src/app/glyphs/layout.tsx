import type { ReactNode } from "react";

export default function GlyphsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black text-violet-100/90">
      {children}
    </div>
  );
}