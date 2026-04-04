"use client";

import { useState, useEffect } from "react";

const COLORS = [
  "#8b5cf6", // Violet
  "#06b6d4", // Cyan
  "#10b981", // Emerald
  "#e11d48", // Crimson
  "#f59e0b", // Amber
];

export default function NodeEditorPanel({
  nodeId,
  projectId,
  onClose,
  onUpdate,
}: {
  nodeId: string;
  projectId: string;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [referenceType, setReferenceType] = useState<string | null>(null);
  const [nodeType, setNodeType] = useState("Event");
  const [passFullContent, setPassFullContent] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/timeline/nodes/${nodeId}`)
      .then((res) => res.json())
      .then((data) => {
        setTitle(data.title || "");
        setContent(data.content || "");
        setSummary(data.summary || "");
        setColor(data.color || "#8b5cf6");
        setReferenceId(data.referenceId || null);
        setReferenceType(data.referenceType || null);
        setNodeType(data.nodeType || "Event");
        setPassFullContent(data.passFullContent || false);
        setIsLoading(false);
      });
  }, [nodeId]);

  const handleSave = async (updates: any) => {
    await fetch(`/api/timeline/nodes/${nodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    onUpdate();
  };

  const handleColorChange = (c: string) => {
    setColor(c);
    handleSave({ color: c });
  };

  const [isExporting, setIsExporting] = useState(false);
  const [templates, setTemplates] = useState<Array<{ name: string; filename: string }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/templates?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTemplates(data); })
      .catch(() => {});
  }, [projectId]);

  const handleSynthesize = async () => {
    setIsSynthesizing(true);
    const res = await fetch(`/api/timeline/nodes/${nodeId}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateFilename: selectedTemplate || undefined }),
    });
    if (res.ok) {
      const data = await res.json();
      setContent(data.content || "");
      setSummary(data.summary || "");
      onUpdate();
    }
    setIsSynthesizing(false);
  };

  const exportToArtifact = async () => {
    if (!title || !projectId) return;
    setIsExporting(true);
    const res = await fetch("/api/wiki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content: content || summary || "",
        projectId,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await handleSave({ referenceType: "wiki", referenceId: data.id });
      setReferenceType("wiki");
      setReferenceId(data.id);
    }
    setIsExporting(false);
  };

  const exportToCrystal = async () => {
    if (!title || !projectId) return;
    setIsExporting(true);
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content: content || summary || "",
        projectId,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await handleSave({ referenceType: "document", referenceId: data.id });
      setReferenceType("document");
      setReferenceId(data.id);
    }
    setIsExporting(false);
  };

  if (isLoading) return null;

  return (
    <div className="absolute right-4 top-4 bottom-4 w-80 bg-[#020005] border-l-4 border-violet-500/70 p-4 shadow-[0_0_20px_rgba(139,92,246,0.15)] flex flex-col font-mono text-xs z-20">
      <div className="flex justify-between items-center mb-4 border-b border-violet-800/60 pb-2">
        <span className="font-bold text-violet-500 uppercase tracking-widest">&gt; NODE_CONFIG</span>
        <button onClick={onClose} className="text-violet-600 hover:text-violet-300">
          [X]
        </button>
      </div>

      <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-violet-600 uppercase tracking-widest">Title</label>
          <input
            className="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => handleSave({ title })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-violet-600 uppercase tracking-widest">Node Type</label>
          <select
            className="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none uppercase text-[10px]"
            value={nodeType}
            onChange={(e) => {
              setNodeType(e.target.value);
              handleSave({ nodeType: e.target.value });
            }}
          >
            <optgroup label="Narrative">
              <option value="Event">Event</option>
              <option value="Scene">Scene</option>
              <option value="Character Arc">Character Arc</option>
              <option value="Lore">Lore</option>
            </optgroup>
            <optgroup label="Technical">
              <option value="Hypothesis">Hypothesis</option>
              <option value="Evidence">Evidence</option>
              <option value="Code Snippet">Code Snippet</option>
              <option value="Conclusion">Conclusion</option>
              <option value="Reference">Reference</option>
            </optgroup>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 cursor-pointer text-violet-400 hover:text-violet-300">
            <input
              type="checkbox"
              className="accent-violet-500 rounded-none bg-black border-violet-900 focus:ring-violet-500 focus:ring-offset-0"
              checked={passFullContent}
              onChange={(e) => {
                setPassFullContent(e.target.checked);
                handleSave({ passFullContent: e.target.checked });
              }}
            />
            <span className="text-[10px] uppercase tracking-widest font-bold">INJECT FULL CONTENT DOWNSTREAM</span>
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-violet-600 uppercase tracking-widest">Color Variant</label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => handleColorChange(c)}
                className="w-6 h-6 border"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? "white" : "transparent",
                  opacity: color === c ? 1 : 0.5,
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[10px] text-violet-600 uppercase tracking-widest">Content</label>
          <textarea
            className="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none flex-1 resize-none"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={() => handleSave({ content })}
            placeholder="Full scene prose, beats, or pasted draft for this event. Sent to the model in full when this node is focused."
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-violet-600 uppercase tracking-widest">Summary (LLM Context)</label>
          <textarea
            className="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none h-24 resize-none"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={() => handleSave({ summary })}
            placeholder="Short recap for ancestor context only — what later nodes must remember. Used for upstream nodes in graph RAG, not the focused node's full text."
          />
        </div>
        
        {referenceId && (
          <div className="mt-2 text-[10px] text-violet-500 border border-violet-900/40 p-2 bg-violet-950/20">
            Linked to {referenceType === "document" ? "CRYSTAL_DB" : "ARTIFACT"}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2 pt-4 border-t border-violet-800/60">
        {templates.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-violet-600 uppercase tracking-widest">Template</label>
            <select
              className="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none text-[10px]"
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
            >
              <option value="">None (free-form synthesis)</option>
              {templates.map((t) => (
                <option key={t.filename} value={t.filename}>{t.name}</option>
              ))}
            </select>
          </div>
        )}
        <button 
          onClick={handleSynthesize} 
          disabled={isSynthesizing} 
          className="border border-fuchsia-700/60 bg-fuchsia-950/40 text-fuchsia-500 py-1.5 hover:bg-fuchsia-900/60 uppercase tracking-widest text-[10px] font-bold disabled:opacity-50"
        >
          {isSynthesizing ? "[ PROCESSING... ]" : selectedTemplate ? "[ SYNTHESIZE_WITH_TEMPLATE ]" : "[ AUTO_SYNTHESIZE ]"}
        </button>

        {!referenceId && (
          <>
            <button onClick={exportToArtifact} disabled={isExporting} className="border border-cyan-700/60 bg-cyan-950/40 text-cyan-500 py-1.5 hover:bg-cyan-900/60 uppercase tracking-widest text-[10px] font-bold disabled:opacity-50">
              {isExporting ? "[ EXPORTING... ]" : "[ EXPORT_TO_ARTIFACT ]"}
            </button>
            <button onClick={exportToCrystal} disabled={isExporting} className="border border-amber-700/60 bg-amber-950/40 text-amber-500 py-1.5 hover:bg-amber-900/60 uppercase tracking-widest text-[10px] font-bold disabled:opacity-50">
              {isExporting ? "[ EXPORTING... ]" : "[ EXPORT_TO_CRYSTAL ]"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}