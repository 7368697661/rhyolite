import type { ReactNode } from "react";

"use client";

import { useEffect } from "react";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const updateMousePos = (e: MouseEvent) => {
      document.documentElement.style.setProperty("--mouse-x", `${e.clientX}px`);
      document.documentElement.style.setProperty("--mouse-y", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", updateMousePos);
    return () => window.removeEventListener("mousemove", updateMousePos);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-violet-300 selection:bg-violet-500 selection:text-black">
      <div className="crt-overlay"></div>
      <div className="crosshair-x"></div>
      <div className="crosshair-y"></div>
      <div className="crosshair-center"></div>
      {children}
    </div>
  );
}