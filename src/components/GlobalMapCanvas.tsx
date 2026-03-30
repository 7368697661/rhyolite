"use client";

import ReactFlow, {
  Background,
  BackgroundVariant,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";

type ApiNetworkNodeKind = "document" | "wiki" | "event";

function NetworkNode({ data }: NodeProps) {
  const color = (data as any)?.color || "#8b5cf6";
  const kind = (data as any)?.kind as ApiNetworkNodeKind | undefined;
  const title = (data as any)?.title as string | undefined;
  const isActive = Boolean((data as any)?.isActive);
  const isRelated = Boolean((data as any)?.isRelated);
  const hasSelection = Boolean((data as any)?.hasSelection);

  const badge =
    kind === "document"
      ? "[DOC]"
      : kind === "wiki"
        ? "[ART]"
        : kind === "event"
          ? "[EVT]"
          : "[NODE]";

  const handleStyle = { background: color, width: 6, height: 6, border: "none", opacity: 0 };

  return (
    <div
      className="bg-[#020005] border p-3 font-mono text-[10px] uppercase tracking-widest text-violet-300 relative shadow-[0_0_18px_rgba(167,139,250,0.15)]"
      style={{
        borderColor: color,
        boxShadow: `0 0 18px ${color}22`,
        minWidth: 180,
        opacity: !hasSelection ? 0.8 : isActive ? 1 : isRelated ? 0.9 : 0.2,
        transform: isActive ? "scale(1.02)" : undefined,
        transition: "opacity 120ms ease, transform 120ms ease, box-shadow 120ms ease",
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="target" position={Position.Left} id="left-target" style={handleStyle} />
      <div className="flex items-center justify-between mb-2 pb-1 border-b" style={{ borderColor: `${color}66` }}>
        <span className="font-bold" style={{ color }}>
          {badge}
        </span>
        {isActive ? (
          <span className="text-[8px] opacity-90">ACTIVE</span>
        ) : (
          <span className="text-[8px] opacity-70">ID: {(data as any)?.id ?? ""}</span>
        )}
      </div>
      <div className="font-bold text-violet-200 mb-1 truncate">{title || "[ NO_TITLE ]"}</div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      <Handle type="source" position={Position.Right} id="right-source" style={handleStyle} />
    </div>
  );
}

function RelationshipEdge(props: any) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
    label,
    id,
  } = props;

  const kind = data?.kind as "timeline" | "reference" | "tag" | "link" | undefined;
  const isContentLink = kind === "link";
  const stroke =
    isContentLink
      ? "#e879f9"
      : kind === "tag"
        ? "#2dd4bf"
        : kind === "reference"
          ? "#fbbf24"
          : "#a78bfa";
  const lineWidth = isContentLink ? 1 : kind === "timeline" ? 2.5 : 1.8;
  const lineOpacity = isContentLink ? 0.25 : 0.7;

  const x1 = Number(sourceX);
  const y1 = Number(sourceY);
  const x2 = Number(targetX);
  const y2 = Number(targetY);

  const ok = Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2);
  const labelX = ok ? (x1 + x2) / 2 : 0;
  const labelY = ok ? (y1 + y2) / 2 : 0;

  return (
    <g>
      <path
        id={id}
        d={ok ? `M${x1},${y1} L${x2},${y2}` : ""}
        fill="none"
        stroke={stroke}
        strokeWidth={lineWidth}
        opacity={lineOpacity}
      />
      {label ? (
        <text
          x={labelX}
          y={labelY}
          fontSize={10}
          fontFamily="monospace"
          fill="#c4b5fd"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ filter: "drop-shadow(0 0 6px rgba(167,139,250,0.15))" }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

type GlobalMapActiveItem = {
  type: "document" | "wiki" | "timeline" | "project_settings" | "network";
  id: string;
};

export default function GlobalMapCanvas({
  projectId,
  onNavigate,
  onTimelineNodeSelect,
}: {
  projectId: string;
  onNavigate: (item: GlobalMapActiveItem) => void;
  onTimelineNodeSelect: (id: string | null) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);
  const nodeTypes = useMemo(() => ({ network: NetworkNode }), []);
  const edgeTypes = useMemo(() => ({ relationship: RelationshipEdge }), []);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<{
    kind: ApiNetworkNodeKind;
    entityId?: string | null;
    title: string;
    content?: string | null;
    summary?: string | null;
    nodeType?: string | null;
    passFullContent?: boolean | null;
    referenceType?: string | null;
    referenceId?: string | null;
    timelineId?: string | null;
    documentId?: string | null;
    tags?: Array<{ id: string; title: string }>;
  } | null>(null);

  const simStartedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    simStartedRef.current = false;

    fetch(`/api/projects/${projectId}/network`)
      .then((res) => res.json())
      .then((data) => {
        const nextNodes: Node[] = (data.nodes ?? []).map((n: any) => ({
          id: n.id,
          type: "network",
          position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
          data: {
            ...n.data,
            id: n.id,
          },
        }));

        const nextEdges: Edge[] = (data.edges ?? []).map((e: any) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: "relationship",
          animated: false,
          label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : undefined,
          data: { kind: e.kind ?? "reference" },
          style: {
            stroke: "transparent",
          },
        }));

        setNodes(nextNodes);
        setEdges(nextEdges);
      });
  }, [projectId, setNodes, setEdges]);

  useEffect(() => {
    // Update node visuals to highlight the selected node and its directly-connected neighbors.
    setNodes((prev) => {
      if (!selectedNodeId) {
        return prev.map((n) => ({
          ...n,
          data: { ...n.data, isActive: false, isRelated: false, hasSelection: false },
        }));
      }

      const related = new Set<string>([selectedNodeId]);
      for (const e of edges) {
        const s = typeof e.source === "string" ? e.source : (e.source as any)?.id;
        const t = typeof e.target === "string" ? e.target : (e.target as any)?.id;
        if (!s || !t) continue;
        if (s === selectedNodeId) related.add(t);
        if (t === selectedNodeId) related.add(s);
      }

      return prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isActive: n.id === selectedNodeId,
          isRelated: related.has(n.id),
          hasSelection: true,
        },
      }));
    });
  }, [selectedNodeId, edges, setNodes]);

  const handleNodeClick = useCallback(
    async (_event: unknown, node: Node) => {
      const d = node.data as any;
      const kind = d.kind as ApiNetworkNodeKind;

      setSelectedNodeId(node.id);
      setPreviewOpen(true);
      setIsPreviewLoading(true);

      try {
        if (kind === "document") {
          const docId = d.entityId ?? (node.id.startsWith("doc:") ? node.id.slice(4) : node.id);
          const res = await fetch(`/api/documents/${docId}`);
          if (!res.ok) throw new Error("Failed to load document");
          const doc = await res.json();
          setPreview({
            kind,
            entityId: docId,
            title: doc.title ?? d.title ?? "[ NO_TITLE ]",
            content: doc.content ?? "",
            documentId: docId,
            timelineId: null,
          });
          return;
        }

        if (kind === "wiki") {
          const wikiId = d.entityId ?? (node.id.startsWith("wiki:") ? node.id.slice(5) : node.id);
          const res = await fetch(`/api/wiki/${wikiId}`);
          if (!res.ok) throw new Error("Failed to load artifact");
          const wiki = await res.json();
          setPreview({
            kind,
            entityId: wikiId,
            title: wiki.title ?? d.title ?? "[ NO_TITLE ]",
            content: wiki.content ?? "",
            documentId: null,
            timelineId: null,
          });
          return;
        }

        // event
        const eventId = d.entityId ?? (node.id.startsWith("evt:") ? node.id.slice(4) : node.id);
        const timelineId = d.timelineId ?? null;
        const res = await fetch(`/api/timeline/nodes/${eventId}`);
        if (!res.ok) throw new Error("Failed to load event");
        const evt = await res.json();
        setPreview({
          kind,
          entityId: eventId,
          title: evt.title ?? d.title ?? "[ NO_TITLE ]",
          summary: evt.summary ?? null,
          content: evt.content ?? null,
          nodeType: evt.nodeType ?? d.nodeType ?? null,
          passFullContent: evt.passFullContent ?? d.passFullContent ?? null,
          referenceType: evt.referenceType ?? d.referenceType ?? null,
          referenceId: evt.referenceId ?? d.referenceId ?? null,
          timelineId: timelineId,
          documentId: d.documentId ?? null,
          tags: (evt.tags ?? []).map((t: any) => ({ id: t.id, title: t.title })),
        });
      } catch (err) {
        console.error(err);
        setPreview({
          kind,
          entityId: d.entityId ?? null,
          title: d.title ?? "[ NO_TITLE ]",
          content: null,
          timelineId: d.timelineId ?? null,
          documentId: d.documentId ?? null,
        });
      } finally {
        setIsPreviewLoading(false);
      }
    },
    []
  );

  const handleEdgeClick = useCallback(
    (event: unknown, edge: any) => {
      const targetId =
        typeof edge?.target === "string" ? edge.target : (edge?.target as any)?.id;
      if (!targetId) return;
      const targetNode = nodes.find((n) => n.id === targetId);
      if (targetNode) handleNodeClick(event, targetNode);
    },
    [handleNodeClick, nodes]
  );

  useEffect(() => {
    if (simStartedRef.current) return;
    if (nodes.length === 0) return;

    simStartedRef.current = true;

    const nodeCount = nodes.length;
    const spread = Math.max(600, nodeCount * 60);

    const simNodes = nodes.map((n) => {
      const kind = (n.data as any)?.kind as ApiNetworkNodeKind | undefined;
      const radius = kind === "event" ? 46 : kind === "wiki" ? 72 : 80;
      return {
        id: n.id,
        x: (Math.random() - 0.5) * spread,
        y: (Math.random() - 0.5) * spread,
        vx: 0,
        vy: 0,
        r: radius,
      };
    });

    const byId = new Map(simNodes.map((sn) => [sn.id, sn] as const));

    const links = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    const simulation = forceSimulation(simNodes as any)
      .force("charge", forceManyBody().strength(-1200).distanceMax(1200))
      .force(
        "link",
        forceLink(links as any)
          .id((d: any) => d.id)
          .distance(350)
          .strength(0.05)
      )
      .force("collide", forceCollide().radius((d: any) => d.r + 40).strength(0.8))
      .force("center", forceCenter(0, 0).strength(0.03))
      .alphaDecay(0.02);

    simulation.on("tick", () => {
      // Throttle reactflow state updates to the next animation frame.
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setNodes((prev) =>
          prev.map((n) => {
            const sn = byId.get(n.id);
            if (!sn) return n;
            return {
              ...n,
              position: { x: sn.x ?? 0, y: sn.y ?? 0 },
            };
          })
        );
      });
    });

    return () => {
      simulation.stop();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Intentionally depend on lengths only to avoid restarting each tick.
  }, [nodes.length, edges.length, setNodes]);

  const handleOpenPreview = useCallback(() => {
    if (!preview?.kind || !preview.entityId) return;

    if (preview.kind === "document") {
      onNavigate({ type: "document", id: preview.entityId });
      return;
    }

    if (preview.kind === "wiki") {
      onNavigate({ type: "wiki", id: preview.entityId });
      return;
    }

    // event node -> open timeline and select node
    if (preview.kind === "event") {
      const timelineId = preview.timelineId;
      if (timelineId) {
        onNavigate({ type: "timeline", id: timelineId });
        onTimelineNodeSelect(preview.entityId ?? null);
        return;
      }

      // Legacy document-scoped DAG nodes don't map cleanly to a Timeline view in the UI.
      // At minimum, open the owning document so the user can continue from there.
      if (preview.documentId) {
        onNavigate({ type: "document", id: preview.documentId });
      }
    }
  }, [onNavigate, onTimelineNodeSelect, preview]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          nodesDraggable={false}
          draggable={false}
          zoomOnScroll
          minZoom={0.2}
          maxZoom={1.6}
          onNodeClick={handleNodeClick as any}
          onEdgeClick={handleEdgeClick as any}
          onPaneClick={() => {
            setSelectedNodeId(null);
            setPreviewOpen(false);
          }}
          className="bg-[#050308]"
        >
          <Background variant={BackgroundVariant.Dots} gap={48} size={1} />
        </ReactFlow>
      </ReactFlowProvider>

      {previewOpen && selectedNodeId && preview ? (
        <div className="absolute right-0 top-0 h-full w-[22rem] border-l border-violet-500/40 bg-[#020005]/90 backdrop-blur px-3 py-3 z-20 overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">
                :: Preview
              </div>
              <div className="mt-1 truncate font-heading text-base text-violet-100">
                {preview.title}
              </div>
              <div className="mt-1 text-[10px] font-mono text-violet-300/80">
                KIND: {preview.kind.toUpperCase()}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="shrink-0 border border-violet-700/60 bg-black px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-violet-300 hover:border-violet-400"
            >
              [ X ]
            </button>
          </div>

          {preview.kind !== "event" && (
            <div className="mt-3 border border-violet-800/50 bg-black p-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-violet-500">
                CONTENT
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-[10px] text-violet-100/90 leading-relaxed">
                {(preview.content ?? "").slice(0, 1800)}
                {(preview.content ?? "").length > 1800 ? "\n\n…(truncated)" : ""}
              </pre>
            </div>
          )}

          {preview.kind === "event" && (
            <div className="mt-3 border border-violet-800/50 bg-black p-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-violet-500">
                EVENT DATA
              </div>
              <div className="mt-2 text-[10px] text-violet-100/90">
                {preview.nodeType ? <div>NODE_TYPE: {preview.nodeType}</div> : null}
                {typeof preview.passFullContent === "boolean" ? (
                  <div>PASS_FULL_CONTENT: {preview.passFullContent ? "true" : "false"}</div>
                ) : null}
                {preview.referenceType ? (
                  <div>
                    REF: {preview.referenceType.toUpperCase()} {preview.referenceId ?? ""}
                  </div>
                ) : null}
                {preview.tags && preview.tags.length > 0 ? (
                  <div className="mt-1">
                    TAGS:{" "}
                    {preview.tags
                      .slice(0, 6)
                      .map((t) => t.title)
                      .join(", ")}
                  </div>
                ) : null}
              </div>
              {preview.summary ? (
                <div className="mt-2 text-[10px] text-violet-200/90">
                  <div className="font-bold uppercase tracking-widest text-violet-500 text-[10px]">SUMMARY</div>
                  <pre className="mt-1 whitespace-pre-wrap">{preview.summary}</pre>
                </div>
              ) : null}
              {preview.content ? (
                <div className="mt-2">
                  <div className="font-bold uppercase tracking-widest text-violet-500 text-[10px]">CONTENT</div>
                  <pre className="mt-1 whitespace-pre-wrap text-[10px] text-violet-100/90 leading-relaxed">
                    {preview.content.slice(0, 1400)}
                    {preview.content.length > 1400 ? "\n\n…(truncated)" : ""}
                  </pre>
                </div>
              ) : null}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {preview.kind === "document" && (
              <button
                type="button"
                onClick={handleOpenPreview}
                className="flex-1 border border-violet-500/70 bg-violet-950/60 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-violet-200 hover:border-violet-400 hover:bg-violet-900/60"
              >
                [ OPEN CHAPTER ]
              </button>
            )}
            {preview.kind === "wiki" && (
              <button
                type="button"
                onClick={handleOpenPreview}
                className="flex-1 border border-cyan-500/70 bg-cyan-950/60 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-200 hover:border-cyan-400 hover:bg-cyan-900/60"
              >
                [ OPEN ARTIFACT ]
              </button>
            )}
            {preview.kind === "event" && (
              <>
                {preview.timelineId ? (
                  <button
                    type="button"
                    onClick={handleOpenPreview}
                    className="flex-1 border border-violet-500/70 bg-violet-950/60 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-violet-200 hover:border-violet-400 hover:bg-violet-900/60"
                  >
                    [ OPEN TIMELINE ]
                  </button>
                ) : preview.documentId ? (
                  <button
                    type="button"
                    onClick={handleOpenPreview}
                    className="flex-1 border border-amber-500/70 bg-amber-950/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-200 hover:border-amber-400 hover:bg-amber-900/40"
                  >
                    [ OPEN CHAPTER ]
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleOpenPreview}
                    disabled
                    className="flex-1 border border-violet-700/60 bg-black/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-violet-300/70 cursor-not-allowed opacity-60"
                  >
                    [ OPEN ]
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

