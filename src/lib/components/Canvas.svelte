<script lang="ts">
    import { SvelteFlow, Background, Controls, MiniMap, useSvelteFlow } from '@xyflow/svelte';
    import type { Node, Edge, Connection } from '@xyflow/svelte';
    import '@xyflow/svelte/dist/style.css';
    import { appState } from '$lib/state.svelte';
    import { invoke } from '@tauri-apps/api/core';
    import { generateId } from '$lib/agents/fs-db';
    import TacticalNode from './TacticalNode.svelte';
    import NodeEditor from './NodeEditor.svelte';
    import dagre from 'dagre';
    import { onMount, tick } from 'svelte';
    import { getNetworkGraph } from '$lib/agents/network';
    import { builtInTemplates, type DagTemplate } from '$lib/timeline/dagTemplates';
    import type { FsTimeline, FsTimelineEvent, FsEventEdge } from '$lib/agents/fs-db';
    import { fade, scale } from 'svelte/transition';
    import { backOut } from 'svelte/easing';

    let { mode } = $props<{ mode: 'network' | 'timeline' }>();

    let nodes = $state<Node[]>([]);
    let edges = $state<Edge[]>([]);
    let selectedNodeId = $state<string | null>(null);
    let templateMenuOpen = $state(false);

    // Inline node-creation prompt (replaces browser prompt() which Tauri blocks)
    let showNodePrompt = $state(false);
    let nodePromptTitle = $state('');
    let nodePromptPosition = $state<{x: number; y: number}>({x: 200, y: 200});
    let nodePromptInputEl = $state<HTMLInputElement | null>(null);

    const SNAP_GRID: [number, number] = [16, 16];
    const snapToGrid = (v: number) => Math.round(v / 16) * 16;

    const nodeTypes = { tactical: TacticalNode };

    function applyDagreLayout() {
        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: 'TB', marginx: 20, marginy: 20, ranksep: 80, nodesep: 50 });
        g.setDefaultEdgeLabel(() => ({}));
        nodes.forEach((node) => g.setNode(node.id, { width: 250, height: 100 }));
        edges.forEach((edge) => g.setEdge(edge.source, edge.target));
        dagre.layout(g);
        nodes = nodes.map((node) => {
            const np = g.node(node.id);
            return { ...node, position: { x: np.x - 125, y: np.y - 50 } };
        });
    }

    function getActiveTimeline(): FsTimeline | null {
        if (mode !== 'timeline' || !appState.activeItem || appState.activeItem.type !== 'timeline') return null;
        return appState.timelines.find(t => t.id === appState.activeItem?.id) || null;
    }

    async function persistTimeline(tl: FsTimeline) {
        if (!appState.activeProjectId) return;
        const updated = { ...tl, updatedAt: new Date().toISOString() };
        await invoke('write_timeline', { projectId: appState.activeProjectId, timeline: updated });
        await appState.reloadProjectData();
    }

    function loadTimelineData() {
        const tl = getActiveTimeline();
        if (tl) {
            nodes = tl.events.map(ev => ({
                id: ev.id,
                type: 'tactical',
                position: { x: ev.positionX, y: ev.positionY },
                data: {
                    label: ev.title,
                    summary: ev.summary,
                    nodeType: ev.nodeType,
                    color: ev.color || '#8b5cf6',
                    referenceType: ev.referenceType,
                    passFullContent: ev.passFullContent,
                    tags: ev.tags,
                }
            }));
            edges = tl.edges.map(e => {
                const srcNode = tl.events.find(n => n.id === e.source);
                const edgeColor = srcNode?.color || 'rgba(139, 92, 246, 0.8)';
                return {
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    animated: true,
                    label: e.label || undefined,
                    labelStyle: 'fill: #c4b5fd; font-weight: 700; font-size: 10px; font-family: monospace;',
                    style: `stroke: ${edgeColor}`,
                };
            });
        } else {
            nodes = [];
            edges = [];
        }
    }

    let networkLoadId = 0;
    async function loadNetworkData() {
        if (!appState.activeProjectId) return;
        const loadId = ++networkLoadId;
        const graph = await getNetworkGraph(appState.activeProjectId);
        if (loadId !== networkLoadId) return; // stale load, skip

        const rawNodes = graph.nodes.map(n => ({
            id: n.id,
            type: 'tactical',
            position: { x: 0, y: 0 },
            data: { label: n.data.title, summary: n.data.summary, nodeType: n.data.kind, color: n.data.color }
        }));
        const rawEdges = graph.edges.map(e => ({
            id: e.id, source: e.source, target: e.target,
            label: e.label || undefined,
            style: "stroke: #8b5cf6"
        }));

        // Apply dagre layout synchronously before setting state (no flash)
        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: 'TB', marginx: 20, marginy: 20, ranksep: 80, nodesep: 50 });
        g.setDefaultEdgeLabel(() => ({}));
        rawNodes.forEach(node => g.setNode(node.id, { width: 250, height: 100 }));
        rawEdges.forEach(edge => g.setEdge(edge.source, edge.target));
        dagre.layout(g);

        nodes = rawNodes.map(node => {
            const np = g.node(node.id);
            return { ...node, position: { x: np.x - 125, y: np.y - 50 } };
        });
        edges = rawEdges;
    }

    // Timeline mode: react to active item changes and timeline data
    $effect(() => {
        if (mode !== 'timeline') return;
        void appState.activeItem?.id;
        void appState.timelines;
        loadTimelineData();
    });

    // Network mode: only react to project/navigation, NOT timelines
    $effect(() => {
        if (mode !== 'network') return;
        void appState.activeProjectId;
        void appState.activeItem?.id;
        loadNetworkData();
    });

    // --- Node creation ---
    function handleCreateNode() {
        const tl = getActiveTimeline();
        if (!tl) return;
        nodePromptPosition = { x: snapToGrid(Math.random() * 300 + 100), y: snapToGrid(Math.random() * 300 + 100) };
        nodePromptTitle = '';
        showNodePrompt = true;
        tick().then(() => nodePromptInputEl?.focus());
    }

    function handlePaneDoubleClick(event: MouseEvent) {
        if (mode !== 'timeline') return;
        const tl = getActiveTimeline();
        if (!tl) return;
        nodePromptPosition = { x: snapToGrid(event.offsetX ?? 200), y: snapToGrid(event.offsetY ?? 200) };
        nodePromptTitle = '';
        showNodePrompt = true;
        tick().then(() => nodePromptInputEl?.focus());
    }

    async function confirmNodeCreation() {
        if (!nodePromptTitle.trim()) { showNodePrompt = false; return; }
        const tl = getActiveTimeline();
        if (!tl) { showNodePrompt = false; return; }
        const newNode: FsTimelineEvent = {
            id: generateId(), title: nodePromptTitle.trim(), description: '', date: new Date().toISOString(),
            nodeType: 'Event', positionX: nodePromptPosition.x, positionY: nodePromptPosition.y,
        };
        showNodePrompt = false;
        await persistTimeline({ ...tl, events: [...tl.events, newNode] });
    }

    // --- Edge connection ---
    async function handleConnect(conn: Connection) {
        const tl = getActiveTimeline();
        if (!tl || !conn.source || !conn.target) return;
        const newEdge: FsEventEdge = { id: generateId(), source: conn.source, target: conn.target, label: '' };
        await persistTimeline({ ...tl, edges: [...tl.edges, newEdge] });
    }

    // --- Node drag persistence ---
    async function handleNodeDragStop({ targetNode, nodes: draggedNodes }: { targetNode: Node | null; nodes: Node[]; event: MouseEvent | TouchEvent }) {
        const tl = getActiveTimeline();
        if (!tl) return;
        const movedIds = new Map(draggedNodes.map(n => [n.id, n.position]));
        await persistTimeline({
            ...tl,
            events: tl.events.map(e => {
                const pos = movedIds.get(e.id);
                return pos ? { ...e, positionX: snapToGrid(pos.x), positionY: snapToGrid(pos.y) } : e;
            })
        });
    }

    // --- Delete nodes and edges ---
    async function handleDelete({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node[]; edges: Edge[] }) {
        const tl = getActiveTimeline();
        if (!tl) return;
        const delNodeIds = new Set(deletedNodes.map(n => n.id));
        const delEdgeIds = new Set(deletedEdges.map(e => e.id));
        if (selectedNodeId && delNodeIds.has(selectedNodeId)) selectedNodeId = null;
        await persistTimeline({
            ...tl,
            events: tl.events.filter(e => !delNodeIds.has(e.id)),
            edges: tl.edges.filter(e => !delEdgeIds.has(e.id) && !delNodeIds.has(e.source) && !delNodeIds.has(e.target)),
        });
    }

    // --- Click node to open editor ---
    function handleNodeClick({ event, node }: { event: MouseEvent | TouchEvent; node: Node }) {
        selectedNodeId = node.id;
    }

    function handlePaneClick() {
        selectedNodeId = null;
    }

    // --- Click edge to edit label (inline prompt) ---
    let editingEdge = $state<{id: string; label: string} | null>(null);
    let edgeLabelInputEl = $state<HTMLInputElement | null>(null);

    function handleEdgeClick({ edge }: { edge: Edge; event: MouseEvent }) {
        if (mode !== 'timeline') return;
        editingEdge = { id: edge.id, label: (edge.label as string) || '' };
        tick().then(() => edgeLabelInputEl?.focus());
    }

    async function confirmEdgeLabel() {
        if (!editingEdge) return;
        const tl = getActiveTimeline();
        if (!tl) { editingEdge = null; return; }
        await persistTimeline({
            ...tl,
            edges: tl.edges.map(e => e.id === editingEdge!.id ? { ...e, label: editingEdge!.label } : e)
        });
        editingEdge = null;
    }

    // --- Drop from sidebar ---
    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }

    async function handleDrop(event: DragEvent) {
        event.preventDefault();
        const tl = getActiveTimeline();
        if (!tl) return;
        const dataStr = event.dataTransfer?.getData('text/plain');
        if (!dataStr) return;
        try {
            const data = JSON.parse(dataStr);
            if (data.type !== 'document' && data.type !== 'wiki') return;
            const newNode: FsTimelineEvent = {
                id: generateId(),
                title: data.title || (data.type === 'document' ? 'Linked Chapter' : 'Linked Artifact'),
                description: '', date: new Date().toISOString(), nodeType: 'Reference',
                positionX: snapToGrid(event.offsetX ?? 200), positionY: snapToGrid(event.offsetY ?? 200),
                referenceType: data.type, referenceId: data.id,
            };
            await persistTimeline({ ...tl, events: [...tl.events, newNode] });
        } catch { /* ignore parse errors */ }
    }

    // --- Template application ---
    async function applyTemplate(template: DagTemplate) {
        const tl = getActiveTimeline();
        if (!tl) return;
        templateMenuOpen = false;
        const idMap = new Map<string, string>();
        const newEvents: FsTimelineEvent[] = template.nodes.map(n => {
            const id = generateId();
            idMap.set(n.tempId, id);
            return {
                id, title: n.title, description: '', date: new Date().toISOString(),
                content: n.content, nodeType: n.nodeType, color: n.color,
                positionX: n.positionX, positionY: n.positionY,
            };
        });
        const newEdges: FsEventEdge[] = template.edges.map(e => ({
            id: generateId(),
            source: idMap.get(e.sourceTempId) || '',
            target: idMap.get(e.targetTempId) || '',
            label: e.label,
        })).filter(e => e.source && e.target);
        await persistTimeline({ ...tl, events: [...tl.events, ...newEvents], edges: [...tl.edges, ...newEdges] });
    }

    const narrativeTemplates = $derived(builtInTemplates.filter(t => t.category === 'narrative'));
    const technicalTemplates = $derived(builtInTemplates.filter(t => t.category === 'technical'));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="h-full w-full bg-[#050308] relative"
    ondragover={mode === 'timeline' ? handleDragOver : undefined}
    ondrop={mode === 'timeline' ? handleDrop : undefined}
    ondblclick={mode === 'timeline' ? handlePaneDoubleClick : undefined}
>
    <div class="absolute top-4 left-4 z-50 p-2 bg-black/80 border border-violet-600/50 text-[10px] uppercase tracking-widest text-violet-400 font-bold backdrop-blur-sm shadow-uv-glow rounded-lg">
        [ {mode === 'network' ? 'GLOBAL NETWORK' : 'TIMELINE CANVAS'} ]
    </div>

    <div class="absolute top-4 right-4 z-50 flex gap-2">
        {#if mode === 'timeline'}
            <div class="relative">
                <button
                    class="px-3 py-1.5 bg-violet-950/40 border border-violet-600/50 text-[10px] uppercase tracking-widest text-violet-300 hover:bg-violet-900/60 hover:text-violet-100 transition-colors rounded-lg"
                    onclick={() => templateMenuOpen = !templateMenuOpen}
                >[ Relief ]</button>
                {#if templateMenuOpen}
                    <div class="absolute right-0 top-full mt-1 w-64 border border-violet-500/70 bg-[#020005] shadow-[0_0_20px_rgba(139,92,246,0.2)] z-50 rounded-lg overflow-hidden">
                        <div class="px-3 py-2 border-b border-violet-800/60 text-[9px] uppercase tracking-[0.25em] text-violet-500 font-bold">Apply Relief</div>
                        {#if narrativeTemplates.length > 0}
                            <div class="px-3 py-1.5 text-[8px] uppercase tracking-[0.3em] text-violet-600 bg-violet-950/30">Narrative</div>
                            {#each narrativeTemplates as t}
                                <button class="w-full text-left px-3 py-2 hover:bg-violet-900/30 border-b border-violet-900/30 transition-colors" onclick={() => applyTemplate(t)}>
                                    <div class="text-[10px] font-bold uppercase tracking-widest text-violet-300">{t.name}</div>
                                    <div class="text-[9px] text-violet-500 mt-0.5 normal-case tracking-normal">{t.description}</div>
                                </button>
                            {/each}
                        {/if}
                        {#if technicalTemplates.length > 0}
                            <div class="px-3 py-1.5 text-[8px] uppercase tracking-[0.3em] text-violet-600 bg-violet-950/30">Technical</div>
                            {#each technicalTemplates as t}
                                <button class="w-full text-left px-3 py-2 hover:bg-violet-900/30 border-b border-violet-900/30 transition-colors" onclick={() => applyTemplate(t)}>
                                    <div class="text-[10px] font-bold uppercase tracking-widest text-violet-300">{t.name}</div>
                                    <div class="text-[9px] text-violet-500 mt-0.5 normal-case tracking-normal">{t.description}</div>
                                </button>
                            {/each}
                        {/if}
                        {#if builtInTemplates.length === 0}
                            <div class="px-3 py-3 text-[10px] text-violet-600 uppercase tracking-widest">No reliefs available</div>
                        {/if}
                    </div>
                {/if}
            </div>
            <button
                class="px-3 py-1.5 bg-violet-950/80 border border-violet-500/70 text-[10px] font-bold uppercase tracking-widest text-violet-100 hover:border-violet-400 transition-colors rounded-lg"
                onclick={handleCreateNode}
            >[ + Node ]</button>
        {/if}
        <button
            class="px-3 py-1.5 bg-violet-950/40 border border-violet-600/50 text-[10px] uppercase tracking-widest text-violet-300 hover:bg-violet-900/60 hover:text-violet-100 transition-colors rounded-lg"
            onclick={applyDagreLayout}
        >[ Auto Layout ]</button>
    </div>

    <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        fitView
        colorMode="dark"
        snapGrid={SNAP_GRID}
        deleteKey={['Backspace', 'Delete']}
        onconnect={handleConnect}
        onnodedragstop={handleNodeDragStop}
        ondelete={handleDelete}
        onnodeclick={handleNodeClick}
        onedgeclick={handleEdgeClick}
        onpaneclick={handlePaneClick}
    >
        <Background bgColor="#020005" gap={16} size={1} />
        <Controls />
        <MiniMap
            nodeColor="rgba(139, 92, 246, 0.5)"
            maskColor="rgba(0, 0, 0, 0.5)"
        />
    </SvelteFlow>

    {#if selectedNodeId && mode === 'timeline' && appState.activeItem?.id}
        <NodeEditor
            nodeId={selectedNodeId}
            timelineId={appState.activeItem.id}
            onClose={() => selectedNodeId = null}
            onUpdate={() => loadTimelineData()}
        />
    {/if}

    {#if showNodePrompt}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onclick={() => showNodePrompt = false} transition:fade={{ duration: 150 }}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="bg-[#050308] border border-violet-600/50 p-4 rounded-lg shadow-lg w-72" onclick={(e) => e.stopPropagation()} transition:scale={{ duration: 300, start: 0.95, easing: backOut }}>
                <div class="text-[10px] uppercase tracking-widest text-violet-400 font-bold mb-2">New Node</div>
                <input
                    bind:this={nodePromptInputEl}
                    bind:value={nodePromptTitle}
                    class="w-full bg-black border border-violet-900/50 p-2 text-violet-200 text-xs rounded-md outline-none focus:border-violet-500 mb-3"
                    placeholder="Node title..."
                    onkeydown={(e) => { if (e.key === 'Enter') confirmNodeCreation(); if (e.key === 'Escape') showNodePrompt = false; }}
                />
                <div class="flex gap-2 justify-end">
                    <button class="px-3 py-1 text-[10px] uppercase tracking-widest text-violet-500 hover:text-violet-200 transition-colors" onclick={() => showNodePrompt = false}>Cancel</button>
                    <button class="px-3 py-1 bg-violet-900/40 border border-violet-500 text-[10px] uppercase tracking-widest text-violet-100 hover:bg-violet-600 rounded-md transition-colors" onclick={confirmNodeCreation}>Create</button>
                </div>
            </div>
        </div>
    {/if}

    {#if editingEdge}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onclick={() => editingEdge = null} transition:fade={{ duration: 150 }}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="bg-[#050308] border border-violet-600/50 p-4 rounded-lg shadow-lg w-72" onclick={(e) => e.stopPropagation()} transition:scale={{ duration: 300, start: 0.95, easing: backOut }}>
                <div class="text-[10px] uppercase tracking-widest text-violet-400 font-bold mb-2">Edge Label</div>
                <input
                    bind:this={edgeLabelInputEl}
                    bind:value={editingEdge.label}
                    class="w-full bg-black border border-violet-900/50 p-2 text-violet-200 text-xs rounded-md outline-none focus:border-violet-500 mb-3"
                    placeholder="e.g. Leads to, Supports, Contradicts..."
                    onkeydown={(e) => { if (e.key === 'Enter') confirmEdgeLabel(); if (e.key === 'Escape') editingEdge = null; }}
                />
                <div class="flex gap-2 justify-end">
                    <button class="px-3 py-1 text-[10px] uppercase tracking-widest text-violet-500 hover:text-violet-200 transition-colors" onclick={() => editingEdge = null}>Cancel</button>
                    <button class="px-3 py-1 bg-violet-900/40 border border-violet-500 text-[10px] uppercase tracking-widest text-violet-100 hover:bg-violet-600 rounded-md transition-colors" onclick={confirmEdgeLabel}>Save</button>
                </div>
            </div>
        </div>
    {/if}
</div>
