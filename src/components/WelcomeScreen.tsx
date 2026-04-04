"use client";

import { useState } from "react";

interface WelcomeScreenProps {
  isCreating: boolean;
  onCreateExample: () => void;
  onDismiss: () => void;
}

const CONCEPTS = [
  {
    icon: "◇",
    title: "Crystals",
    description:
      "Your main writing documents — chapters, scenes, drafts. Each crystal is a self-contained piece of your narrative.",
  },
  {
    icon: "◆",
    title: "Artifacts",
    description:
      "Wiki-style entries for characters, locations, factions, items, and lore. Linked to your crystals for context-aware AI assistance.",
  },
  {
    icon: "◈",
    title: "Timelines",
    description:
      "Visual DAG (directed acyclic graph) editor for plotting events, cause-and-effect chains, and story structure.",
  },
  {
    icon: "▣",
    title: "Comms",
    description:
      "AI chat with three modes: Ask (questions), Agent (tool-using AI that can read/write your project), and Plan (review before execution).",
  },
];

export default function WelcomeScreen({
  isCreating,
  onCreateExample,
  onDismiss,
}: WelcomeScreenProps) {
  const [tourStep, setTourStep] = useState<number | null>(null);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#020005] p-8 overflow-y-auto">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-10">
          <div className="font-mono text-violet-600 text-[10px] uppercase tracking-[0.4em] mb-2">
            Welcome to
          </div>
          <h1 className="font-heading text-4xl tracking-[0.3em] text-violet-200 [text-shadow:0_0_20px_rgba(167,139,250,0.6)] mb-3">
            RHYOLITE//
          </h1>
          <p className="text-violet-400 text-sm max-w-md mx-auto leading-relaxed">
            A creative writing workspace with AI-powered worldbuilding tools.
            Organize your narrative with crystals, artifacts, timelines, and
            intelligent chat.
          </p>
        </div>

        {tourStep === null ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-8">
              {CONCEPTS.map((c, i) => (
                <button
                  key={c.title}
                  type="button"
                  onClick={() => setTourStep(i)}
                  className="border border-violet-800/60 bg-violet-950/20 p-4 text-left hover:border-violet-600 hover:bg-violet-950/40 transition-colors"
                >
                  <div className="text-violet-400 text-lg mb-1">{c.icon}</div>
                  <div className="text-violet-200 text-xs font-bold uppercase tracking-wider mb-1">
                    {c.title}
                  </div>
                  <div className="text-violet-500 text-[10px] leading-relaxed">
                    {c.description}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={onCreateExample}
                disabled={isCreating}
                className="border border-violet-500/60 bg-violet-950/50 px-8 py-3 text-xs font-bold uppercase tracking-[0.2em] text-violet-200 hover:border-violet-400 hover:bg-violet-900/40 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(139,92,246,0.15)]"
              >
                {isCreating
                  ? "Creating..."
                  : "Create Example Project"}
              </button>
              <span className="text-[9px] text-violet-700 uppercase tracking-wider">
                Sets up a sample novel with characters, timeline, and chapters
              </span>

              <button
                type="button"
                onClick={onDismiss}
                className="mt-2 text-[10px] text-violet-700 hover:text-violet-400 uppercase tracking-wider"
              >
                Skip — start from scratch
              </button>
            </div>
          </>
        ) : (
          <div className="border border-violet-700/60 bg-violet-950/20 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-violet-400 text-2xl">
                {CONCEPTS[tourStep].icon}
              </div>
              <div className="flex gap-1">
                {CONCEPTS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setTourStep(i)}
                    className={`w-2 h-2 ${
                      i === tourStep
                        ? "bg-violet-400"
                        : "bg-violet-800 hover:bg-violet-600"
                    }`}
                  />
                ))}
              </div>
            </div>
            <h2 className="text-violet-200 text-sm font-bold uppercase tracking-wider mb-2">
              {CONCEPTS[tourStep].title}
            </h2>
            <p className="text-violet-400 text-xs leading-relaxed mb-4">
              {CONCEPTS[tourStep].description}
            </p>
            <div className="text-[10px] text-violet-500 leading-relaxed mb-6">
              {tourStep === 0 && (
                <p>
                  Crystals live in the left sidebar under your project. Click <strong>+ Crystal</strong> to create one.
                  The center editor supports rich markdown with headers, lists, and formatting. Your AI chat automatically
                  uses the active crystal as context when answering questions.
                </p>
              )}
              {tourStep === 1 && (
                <p>
                  Artifacts are your world encyclopedia. Create entries for characters, locations, magic systems — anything
                  the AI should know about. When you mention an artifact&apos;s name in chat, it&apos;s automatically retrieved
                  for context. In <strong>Agent mode</strong>, the AI can create and edit artifacts directly.
                </p>
              )}
              {tourStep === 2 && (
                <p>
                  Timelines let you plot your story&apos;s events visually. Add nodes (events), connect them with edges
                  (causality), and tag them with artifact references. The DAG structure supports branching storylines
                  and parallel plot threads. In <strong>Agent mode</strong>, the AI can build timelines for you.
                </p>
              )}
              {tourStep === 3 && (
                <p>
                  Comms is your AI assistant panel. <strong>Ask mode</strong> answers questions using your project context.
                  <strong> Agent mode</strong> gives the AI tools to search, create, and modify your project.
                  <strong> Plan mode</strong> lets the AI propose changes for your review before executing them.
                  Toggle reasoning to see the AI&apos;s thought process.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              {tourStep > 0 && (
                <button
                  type="button"
                  onClick={() => setTourStep((s) => (s ?? 1) - 1)}
                  className="border border-violet-800/60 bg-black px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-400 hover:border-violet-600"
                >
                  ← Prev
                </button>
              )}
              {tourStep < CONCEPTS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setTourStep((s) => (s ?? 0) + 1)}
                  className="border border-violet-700/60 bg-violet-950/40 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-200 hover:border-violet-400"
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setTourStep(null)}
                  className="border border-emerald-700/60 bg-emerald-950/30 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300 hover:border-emerald-400"
                >
                  ✓ Done
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <div className="text-[9px] text-violet-800 font-mono uppercase tracking-wider">
            Keyboard shortcuts: <span className="text-violet-600">⌘K</span> command palette · <span className="text-violet-600">⌘1</span> focus editor · <span className="text-violet-600">⌘2</span> focus chat
          </div>
        </div>
      </div>
    </div>
  );
}
