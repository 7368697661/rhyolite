"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function parseShortcut(shortcut: string) {
  const parts = shortcut
    .toLowerCase()
    .split("+")
    .map((s) => s.trim());

  return {
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key: parts.filter((p) => !["mod", "shift", "alt"].includes(p))[0] ?? "",
  };
}

export function useHotkeys(shortcuts: Record<string, () => void>): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isInteractive = target && INTERACTIVE_TAGS.has(target.tagName);

      for (const [combo, callback] of Object.entries(shortcutsRef.current)) {
        const parsed = parseShortcut(combo);

        if (isInteractive && parsed.key !== "escape") continue;

        const isMac =
          typeof navigator !== "undefined" &&
          /Mac|iPhone|iPad/i.test(navigator.platform ?? "");
        const modPressed = isMac ? e.metaKey : e.ctrlKey;

        if (parsed.mod && !modPressed) continue;
        if (!parsed.mod && (e.metaKey || e.ctrlKey)) continue;
        if (parsed.shift !== e.shiftKey) continue;
        if (parsed.alt !== e.altKey) continue;
        if (e.key.toLowerCase() !== parsed.key) continue;

        e.preventDefault();
        callback();
        return;
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
