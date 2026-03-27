import type { ReactNode } from "react";

export default function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      <div className="scanline-beam"></div>
      {children}
    </div>
  );
}