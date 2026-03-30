"use client";
import { useState, useEffect, useRef } from "react";

type TerminalPromptProps = {
  label: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export default function TerminalPrompt({ label, defaultValue = "", onSubmit, onCancel }: TerminalPromptProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-2 border border-violet-500/50 bg-black px-2 py-1.5 font-mono text-xs animate-fade-in">
      <span className="shrink-0 text-violet-500 font-bold">&gt;</span>
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-violet-600">{label}:</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          if (e.key === "Escape") onCancel();
        }}
        className="min-w-0 flex-1 bg-transparent text-violet-100 outline-none caret-violet-400 placeholder:text-violet-800"
        placeholder="_"
      />
      <button type="button" onClick={() => value.trim() && onSubmit(value.trim())} className="text-violet-400 hover:text-violet-200 px-1">↵</button>
      <button type="button" onClick={onCancel} className="text-violet-700 hover:text-violet-400 px-1">×</button>
    </div>
  );
}

type TerminalConfirmProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function TerminalConfirm({ message, onConfirm, onCancel }: TerminalConfirmProps) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === "y") onConfirm();
      if (e.key === "Escape" || e.key === "n") onCancel();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onConfirm, onCancel]);

  return (
    <div className="flex items-center gap-2 border border-red-800/50 bg-black px-2 py-1.5 font-mono text-xs animate-fade-in">
      <span className="text-red-400 font-bold">!</span>
      <span className="text-violet-300">{message}</span>
      <span className="text-[10px] text-violet-600 ml-auto">[Y]es [N]o</span>
    </div>
  );
}
