"use client";

import { useCallback, useMemo, useEffect, useState, useRef } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
  type NodeProps,
  type Node,
  type Edge,
  type Connection,
  Background,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import NodeEditorPanel from "./NodeEditorPanel";
import type { DagTemplate } from "@/lib/dagTemplates";

type CanvasScope =
  | { mode: "document"; documentId: string }
  | { mode: "timeline"; timelineId: string };

function scopeQuery(s: CanvasScope) {
  return s.mode === "document"
    ? `documentId=${s.documentId}`
    : `timelineId=${s.timelineId}`;
}

function TacticalNode({ data }: NodeProps) {
  const customColor = data.color || "#8b5cf6";

  return (
    <div
      style={{
        borderColor: data.selected ? "#c4b5fd" : customColor,
        boxShadow: data.selected
          ? `0 0 20px ${customColor}80`
          : `0 0 15px ${customColor}26`,
      }}
      className={`bg-[#020005] border p-3 min-w-[200px] font-mono text-[10px] uppercase tracking-widest text-violet-300 relative transition-all`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !border-none !rounded-none"
        style={{ backgroundColor: customColor }}
      />

      <div
        className="flex items-center justify-between mb-2 pb-1 border-b"
        style={{ borderColor: `${customColor}99` }}
      >
        <span className="font-bold" style={{ color: customColor }}>
          &gt; {data.nodeType ? data.nodeType.toUpperCase() : "EVT_NODE"}
        </span>
        <span className="text-[8px] opacity-60">ID: {data.id}</span>
      </div>

      <div className="font-bold text-violet-200 mb-2 truncate">
        {data.label || "[ NO_TITLE ]"}
        {data.referenceType === "document" && (
          <span className="ml-2 text-[8px] text-amber-500 bg-amber-950/40 px-1 py-0.5 border border-amber-900/60">
            [DOC]
          </span>
        )}
        {data.referenceType === "wiki" && (
          <span className="ml-2 text-[8px] text-cyan-500 bg-cyan-950/40 px-1 py-0.5 border border-cyan-900/60">
            [ART]
          </span>
        )}
        {data.passFullContent && (
          <span className="ml-2 text-[8px] text-emerald-500 bg-emerald-950/40 px-1 py-0.5 border border-emerald-900/60" title="Full content passed to RAG context">
            [FULL]
          </span>
        )}
      </div>

      {data.tags && data.tags.length > 0 ? (
        <div
          className="flex flex-wrap gap-1 mt-2 border-t pt-2"
          style={{ borderColor: `${customColor}66` }}
        >
          {data.tags.map((t: string) => (
            <span
              key={t}
              className="bg-[#020005] px-1 py-0.5 text-[8px] border"
              style={{ color: customColor, borderColor: `${customColor}66` }}
            >
              @{t}
            </span>
          ))}
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !border-none !rounded-none"
        style={{ backgroundColor: customColor }}
      />
    </div>
  );
}

function TimelineCanvasInner({
  scope,
  projectId,
  activeNodeId,
  onNodeSelect,
  onReloadProjectData,
}: {
  scope: CanvasScope;
  projectId: string;
  activeNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  onReloadProjectData: () => void;
}) {
  const SNAP_GRID = 16;
  const snapToGrid = (v: number) => Math.round(v / SNAP_GRID) * SNAP_GRID;

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [templates, setTemplates] = useState<DagTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getNodes } = useReactFlow();

  const scopeKey =
    scope.mode === "document"
      ? `documentId=${scope.documentId}`
      : `timelineId=${scope.timelineId}`;
  const documentId = scope.mode === "document" ? scope.documentId : null;
  const timelineId = scope.mode === "timeline" ? scope.timelineId : null;

  const mapPayloadToState = useCallback(
    (data: { nodes: any[]; edges: any[] }) => {
      const mappedNodes: Node[] = data.nodes.map((n: any) => ({
        id: n.id,
        type: "tactical",
        position: { x: n.positionX, y: n.positionY },
        data: {
          id: n.id,
          label: n.title,
          tags: n.tags.map((t: any) => t.title),
          color: n.color,
          referenceType: n.referenceType,
          referenceId: n.referenceId,
          nodeType: n.nodeType,
          passFullContent: n.passFullContent,
        },
      }));

      const mappedEdges: Edge[] = data.edges.map((e: any) => {
        const sourceNode = data.nodes.find((n: any) => n.id === e.sourceId);
        const color = sourceNode?.color || "rgba(139, 92, 246, 0.8)";
        return {
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          animated: true,
          label: e.label,
          labelStyle: { fill: "#c4b5fd", fontWeight: 700, fontSize: 10, fontFamily: "monospace" },
          labelBgStyle: { fill: "#050308", stroke: color, strokeWidth: 1, rx: 0, ry: 0 },
          labelBgPadding: [4, 2],
          style: { stroke: color },
        };
      });

      setNodes(mappedNodes);
      setEdges(mappedEdges);
    },
    [setNodes, setEdges]
  );

  const reloadGraph = useCallback(() => {
    fetch(`/api/timeline?${scopeKey}`)
      .then((res) => res.json())
      .then(mapPayloadToState);
  }, [scopeKey, mapPayloadToState]);

  useEffect(() => {
    fetch(`/api/timeline?${scopeKey}`)
      .then((res) => res.json())
      .then(mapPayloadToState);
  }, [scopeKey, mapPayloadToState]);

  const createPayload = useCallback(
    (title: string, positionX: number, positionY: number, extra?: Record<string, unknown>) => {
      const base = {
        title,
        positionX,
        positionY,
        ...extra,
      };
      if (documentId) return { ...base, documentId };
      return { ...base, timelineId: timelineId! };
    },
    [documentId, timelineId]
  );

  const handleCreateNode = async () => {
    const title = prompt("Node title:");
    if (!title) return;

    const res = await fetch("/api/timeline/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload(
          title,
          snapToGrid(Math.random() * 200),
          snapToGrid(Math.random() * 200)
        )
      ),
    });

    if (res.ok) {
      reloadGraph();
    }
  };

  const handleNodeDragStop = async (_event: unknown, node: Node) => {
    await fetch(`/api/timeline/nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Ensure persisted coords align with snap grid, avoiding reload drift.
        positionX: snapToGrid(node.position.x),
        positionY: snapToGrid(node.position.y),
      }),
    });
  };

  const nodeTypes = useMemo(() => ({ tactical: TacticalNode }), []);

  const handleEdgesDelete = useCallback(async (edgesToDelete: Edge[]) => {
    await Promise.all(
      edgesToDelete.map((edge) =>
        fetch(`/api/timeline/edges/${edge.id}`, { method: "DELETE" })
      )
    );
  }, []);

  const onConnect = useCallback(
    async (params: Connection) => {
      const res = await fetch("/api/timeline/edges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: params.source,
          targetId: params.target,
        }),
      });

      if (res.ok) {
        const newEdge = await res.json();
        const src = getNodes().find((n) => n.id === params.source);
        const stroke =
          (src?.data as { color?: string } | undefined)?.color ||
          "rgba(139, 92, 246, 0.8)";
        setEdges((eds) =>
          addEdge(
            {
              ...params,
              id: newEdge.id,
              animated: true,
              style: { stroke },
            },
            eds
          )
        );
      }
    },
    [setEdges, getNodes]
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect]
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  const onEdgeClick = useCallback(
    async (_: React.MouseEvent, edge: Edge) => {
      const newLabel = prompt(
        "Edge label (e.g. Leads to, Supports, Contradicts):",
        edge.label as string | undefined
      );
      if (newLabel === null) return; // cancelled

      const res = await fetch(`/api/timeline/edges/${edge.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel || null }),
      });

      if (res.ok) {
        reloadGraph();
      }
    },
    [reloadGraph]
  );

  const createNodeAtClientPoint = useCallback(
    async (clientX: number, clientY: number) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY });
      const title = prompt("Node title:");
      if (!title) return;

      const snappedX = snapToGrid(position.x);
      const snappedY = snapToGrid(position.y);

      const res = await fetch("/api/timeline/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createPayload(title, snappedX, snappedY)
        ),
      });

      if (res.ok) {
        reloadGraph();
      }
    },
    [screenToFlowPosition, createPayload, reloadGraph]
  );

  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      createNodeAtClientPoint(event.clientX, event.clientY);
    },
    [createNodeAtClientPoint]
  );

  const handleWrapperDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const t = event.target as HTMLElement;
      if (t.closest(".react-flow__node")) return;
      if (t.closest(".react-flow__controls")) return;
      if (t.closest(".react-flow__minimap")) return;
      if (t.closest(".react-flow__panel")) return;
      onPaneDoubleClick(event);
    },
    [onPaneDoubleClick]
  );

  const handleNodesDelete = useCallback(
    async (nodesToDelete: Node[]) => {
      await Promise.all(
        nodesToDelete.map((node) =>
          fetch(`/api/timeline/nodes/${node.id}`, { method: "DELETE" })
        )
      );
      const activeDeleted = nodesToDelete.find((n) => n.id === activeNodeId);
      if (activeDeleted) onNodeSelect(null);
    },
    [activeNodeId, onNodeSelect]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();

      const dataStr = event.dataTransfer.getData("application/json");
      if (!dataStr) return;

      try {
        const data = JSON.parse(dataStr);
        if (data.type !== "document" && data.type !== "wiki") return;

        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        const snappedX = snapToGrid(position.x);
        const snappedY = snapToGrid(position.y);

        const res = await fetch("/api/timeline/nodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            createPayload(
              data.title ||
                (data.type === "document" ? "Linked Chapter" : "Linked Artifact"),
              snappedX,
              snappedY,
              {
                referenceType: data.type,
                referenceId: data.id,
              }
            )
          ),
        });

        if (res.ok) {
          reloadGraph();
        }
      } catch (err) {
        console.error("Drop parsing error", err);
      }
    },
    [screenToFlowPosition, createPayload, reloadGraph]
  );

  const handleOpenTemplateMenu = useCallback(async () => {
    if (templateMenuOpen) {
      setTemplateMenuOpen(false);
      return;
    }
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/timeline/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingTemplates(false);
      setTemplateMenuOpen(true);
    }
  }, [templateMenuOpen]);

  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      if (!timelineId) return;
      setTemplateMenuOpen(false);
      const res = await fetch("/api/timeline/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, timelineId }),
      });
      if (res.ok) {
        reloadGraph();
      }
    },
    [timelineId, reloadGraph]
  );

  useEffect(() => {
    if (!templateMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        templateMenuRef.current &&
        !templateMenuRef.current.contains(e.target as globalThis.Node)
      ) {
        setTemplateMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [templateMenuOpen]);

  const narrativeTemplates = templates.filter((t) => t.category === "narrative");
  const technicalTemplates = templates.filter((t) => t.category === "technical");

  return (
    <div
      className="w-full h-full bg-[#050308] relative"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDoubleClick={handleWrapperDoubleClick}
    >
      <ReactFlow
        nodes={nodes.map((n) => ({
          ...n,
          data: { ...n.data, selected: n.id === activeNodeId },
        }))}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={handleEdgesDelete}
        onNodesDelete={handleNodesDelete}
        onNodeDragStop={handleNodeDragStop}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        zoomOnDoubleClick={false}
        snapToGrid={true}
        snapGrid={[16, 16]}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        edgesFocusable={true}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="rgba(139, 92, 246, 0.3)"
        />
        <Controls
          className="!bg-[#020005] !border-violet-500/50 !rounded-none !shadow-[0_0_10px_rgba(139,92,246,0.1)] fill-violet-400 [&>button]:!bg-[#020005] [&>button]:!border-b-violet-500/50 [&>button]:!rounded-none hover:[&>button]:!bg-violet-900/30"
          showInteractive={false}
        />
        <MiniMap
          nodeColor="rgba(139, 92, 246, 0.5)"
          maskColor="rgba(0, 0, 0, 0.5)"
          className="!bg-[#020005] !border-violet-500/50 !rounded-none"
        />
      </ReactFlow>

      <div className="absolute top-2 right-2 flex gap-2 z-10">
        <div className="relative" ref={templateMenuRef}>
          <button
            type="button"
            onClick={handleOpenTemplateMenu}
            disabled={scope.mode !== "timeline"}
            className="border border-violet-500/70 bg-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-100 hover:border-violet-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loadingTemplates ? "[ ... ]" : "[ TEMPLATE ]"}
          </button>

          {templateMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 border border-violet-500/70 bg-[#020005] shadow-[0_0_20px_rgba(139,92,246,0.2)] z-50">
              <div className="px-3 py-2 border-b border-violet-800/60 text-[9px] uppercase tracking-[0.25em] text-violet-500 font-bold">
                Apply Template
              </div>

              {narrativeTemplates.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[8px] uppercase tracking-[0.3em] text-violet-600 bg-violet-950/30">
                    Narrative
                  </div>
                  {narrativeTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleApplyTemplate(t.id)}
                      className="w-full text-left px-3 py-2 hover:bg-violet-900/30 border-b border-violet-900/30 transition-colors"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-widest text-violet-300">
                        {t.name}
                      </div>
                      <div className="text-[9px] text-violet-500 mt-0.5 normal-case tracking-normal">
                        {t.description}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {technicalTemplates.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[8px] uppercase tracking-[0.3em] text-violet-600 bg-violet-950/30">
                    Technical
                  </div>
                  {technicalTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleApplyTemplate(t.id)}
                      className="w-full text-left px-3 py-2 hover:bg-violet-900/30 border-b border-violet-900/30 transition-colors"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-widest text-violet-300">
                        {t.name}
                      </div>
                      <div className="text-[9px] text-violet-500 mt-0.5 normal-case tracking-normal">
                        {t.description}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {templates.length === 0 && !loadingTemplates && (
                <div className="px-3 py-3 text-[10px] text-violet-600 uppercase tracking-widest">
                  No templates available
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCreateNode}
          className="border border-violet-500/70 bg-violet-950/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-100 hover:border-violet-400"
        >
          [ + NODE ]
        </button>
      </div>

      {activeNodeId && (
        <NodeEditorPanel
          nodeId={activeNodeId}
          projectId={projectId}
          onClose={() => onNodeSelect(null)}
          onUpdate={() => {
            reloadGraph();
            onReloadProjectData();
          }}
        />
      )}
    </div>
  );
}

export default function TimelineCanvas(props: {
  projectId: string;
  documentId?: string;
  timelineId?: string;
  activeNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  onReloadProjectData: () => void;
}) {
  const hasDoc = Boolean(props.documentId);
  const hasTl = Boolean(props.timelineId);
  if (hasDoc === hasTl) {
    return (
      <div className="p-4 text-xs text-red-400 font-mono">
        [ERR] TimelineCanvas: pass exactly one of documentId or timelineId
      </div>
    );
  }

  const scope: CanvasScope = props.timelineId
    ? { mode: "timeline", timelineId: props.timelineId }
    : { mode: "document", documentId: props.documentId! };

  return (
    <ReactFlowProvider>
      <TimelineCanvasInner
        scope={scope}
        projectId={props.projectId}
        activeNodeId={props.activeNodeId}
        onNodeSelect={props.onNodeSelect}
        onReloadProjectData={props.onReloadProjectData}
      />
    </ReactFlowProvider>
  );
}
