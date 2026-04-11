<script lang="ts">
    import { X, Gem, RotateCw, Square, Check, Loader2, PanelLeftOpen, PanelLeftClose, ZoomOut } from 'lucide-svelte';
    import { fade, scale } from 'svelte/transition';
    import { backOut } from 'svelte/easing';
    import { executePolisherGeneration } from '$lib/agents/infill';
    import { readGlyphs } from '$lib/agents/fs-db';
    import { tick, onMount, onDestroy } from 'svelte';
    import PolisherTree from './PolisherTree.svelte';
    import type { GemNode } from '$lib/polisher/types';

    let {
        projectId,
        selectedText = "",
        fullContent,
        cursorPos,
        onApply,
        onClose
    } = $props<{
        projectId: string;
        selectedText: string;
        fullContent: string;
        cursorPos: number;
        onApply: (text: string) => void;
        onClose: () => void;
    }>();

    // ---------------------------------------------------------------------------
    // Gem Tree State
    // ---------------------------------------------------------------------------

    let nextId = 1;
    function makeId(): string { return `gem_${nextId++}`; }

    const rootNode: GemNode = $state({
        id: makeId(),
        parentId: null,
        text: "",
        children: [],
    });

    let activeNodeId = $state(rootNode.id);
    let rootViewId = $state<string | null>(null); // null = show full tree
    let showGems = $state(false);

    /** Recursive lookup on the $state tree — fully reactive. */
    function findNode(id: string, node: GemNode = rootNode): GemNode | undefined {
        if (node.id === id) return node;
        for (const child of node.children) {
            const found = findNode(id, child);
            if (found) return found;
        }
        return undefined;
    }

    let activeNode = $derived(findNode(activeNodeId) ?? rootNode);
    let viewRoot = $derived(rootViewId ? (findNode(rootViewId) ?? rootNode) : rootNode);

    // ---------------------------------------------------------------------------
    // Generation state
    // ---------------------------------------------------------------------------

    /** Live streaming text for in-flight facets (not yet committed to tree). */
    let pendingFacets = $state<string[]>(["", "", ""]);
    let isGenerating = $state(false);
    let polishedText = $state("");
    let error = $state<string | null>(null);
    let abortController: AbortController | null = null;
    let polishAreaRef = $state<HTMLTextAreaElement | null>(null);

    const isRewrite = selectedText.length > 0;
    const modeLabel = isRewrite ? "Rewriting selection" : "Forward-generating";

    /** The facets displayed in the middle pane: either live pending ones or committed children. */
    let displayFacets = $derived.by(() => {
        if (isGenerating) return pendingFacets;
        return activeNode.children.map((c: GemNode) => c.text);
    });

    // ---------------------------------------------------------------------------
    // Context Resolution — walk from node to root, concatenate branch text
    // ---------------------------------------------------------------------------

    function resolveBranchContext(nodeId: string): string {
        const path: string[] = [];
        let current = findNode(nodeId);
        while (current) {
            if (current.text) path.unshift(current.text);
            current = current.parentId ? findNode(current.parentId) : undefined;
        }
        return path.join("\n\n");
    }

    // ---------------------------------------------------------------------------
    // Tree helpers
    // ---------------------------------------------------------------------------

    function zoomOut() {
        if (!rootViewId) return;
        const vr = findNode(rootViewId);
        rootViewId = vr?.parentId ?? null;
    }

    // ---------------------------------------------------------------------------
    // Generation
    // ---------------------------------------------------------------------------

    onMount(() => { generate(); });
    onDestroy(() => { abortController?.abort(); });

    async function generate() {
        // Pre-flight: verify a Polisher glyph exists
        try {
            const glyphs = await readGlyphs();
            if (!glyphs.some(g => g.isPolisherEngine)) {
                error = "No Glyph is marked as a Polisher Engine. Open the Glyph Registry and enable the \"Polisher Engine\" toggle on a Glyph.";
                return;
            }
        } catch {
            error = "Failed to load Glyphs. Check your workspace configuration.";
            return;
        }

        abortController?.abort();
        const ac = new AbortController();
        abortController = ac;
        isGenerating = true;
        error = null;
        pendingFacets = ["", "", ""];

        // Build cumulative branch context for deeper nodes
        const branchContext = resolveBranchContext(activeNodeId);

        // For the LLM: if we have branch context from the tree, prepend it
        const effectiveSelectedText = branchContext
            ? (isRewrite ? selectedText : "")
            : selectedText;
        const effectiveContent = branchContext
            ? branchContext + "\n\n" + fullContent
            : fullContent;

        try {
            const result = await executePolisherGeneration({
                projectId,
                selectedText: effectiveSelectedText,
                fullContent: effectiveContent,
                cursorPos: branchContext ? effectiveContent.length : cursorPos,
                abortSignal: ac.signal,
                count: 3,
                onDelta: (index, delta) => {
                    pendingFacets[index] += delta;
                },
            });

            // Commit results as child nodes of the active node
            const target = findNode(activeNodeId) ?? rootNode;
            for (const text of result.generations) {
                if (!text.trim()) continue;
                const child: GemNode = {
                    id: makeId(),
                    parentId: activeNodeId,
                    text,
                    children: [],
                };
                target.children.push(child);
            }
        } catch (e: any) {
            if (e?.name !== "AbortError") {
                error = e?.message || String(e);
            }
        } finally {
            isGenerating = false;
        }
    }

    function selectNode(id: string) {
        activeNodeId = id;
    }

    function focusNode(id: string) {
        rootViewId = id;
    }

    function useGeneration(index: number) {
        const text = displayFacets[index];
        if (!text) return;
        polishedText += (polishedText ? "\n" : "") + text;
        tick().then(() => {
            if (polishAreaRef) {
                polishAreaRef.scrollTop = polishAreaRef.scrollHeight;
            }
        });
    }

    /** Select a child facet node and drill down into it for further generation. */
    function drillInto(index: number) {
        const child = activeNode.children[index];
        if (!child) return;
        activeNodeId = child.id;
        showGems = true;
        // Auto-generate if this node has no children yet
        if (child.children.length === 0) {
            generate();
        }
    }

    function handleApply() {
        onApply(polishedText);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm" onclick={onClose} transition:fade={{ duration: 150 }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="flex h-[85vh] w-[95vw] max-w-7xl flex-col border border-violet-600/50 bg-[#020005] shadow-2xl shadow-violet-900/20 rounded-lg overflow-hidden"
        onclick={(e) => e.stopPropagation()}
        transition:scale={{ duration: 300, start: 0.95, easing: backOut }}
    >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-violet-700/40 px-5 py-3 bg-black/60">
            <div class="flex items-center gap-3">
                <Gem size={16} class="text-violet-400" />
                <h2 class="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300">
                    The Polisher
                </h2>
                <span class="text-[9px] uppercase tracking-widest text-violet-600 border border-violet-800/50 px-2 py-0.5 rounded">
                    {modeLabel}
                </span>
            </div>
            <div class="flex items-center gap-2">
                <!-- Gems toggle -->
                <button
                    onclick={() => showGems = !showGems}
                    class="flex items-center gap-1.5 border border-violet-800/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors rounded-md
                        {showGems ? 'bg-violet-900/40 text-violet-200 border-violet-600/60' : 'bg-transparent text-violet-600 hover:text-violet-400 hover:border-violet-700'}"
                >
                    {#if showGems}
                        <PanelLeftClose size={11} />
                    {:else}
                        <PanelLeftOpen size={11} />
                    {/if}
                    Gems
                </button>
                {#if isGenerating}
                    <button
                        onclick={() => abortController?.abort()}
                        class="flex items-center gap-1.5 border border-red-500/60 bg-red-900/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-800/50 hover:border-red-400 transition-colors rounded-md"
                    >
                        <Square size={11} />
                        Stop
                    </button>
                {:else}
                    <button
                        onclick={generate}
                        class="flex items-center gap-1.5 border border-violet-700/60 bg-violet-950/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-300 hover:border-violet-500 hover:text-violet-100 transition-colors rounded-md"
                    >
                        <RotateCw size={11} />
                        Generate Facets
                    </button>
                {/if}
                <button
                    onclick={onClose}
                    class="border border-violet-800/60 bg-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-400 hover:border-violet-600 hover:text-violet-200 rounded-md transition-colors"
                >
                    <X size={12} />
                </button>
            </div>
        </div>

        <!-- Body: 3-pane layout -->
        <div class="flex flex-1 min-h-0">
            <!-- Pane 1: Gems Tree (collapsible left) -->
            {#if showGems}
                <div class="w-56 shrink-0 flex flex-col min-h-0 bg-[#010003] border-r border-violet-800/30">
                    <div class="px-3 py-2 border-b border-violet-900/30 flex items-center justify-between">
                        <span class="text-[9px] uppercase tracking-widest text-violet-600 font-bold">Gem Tree</span>
                        {#if rootViewId}
                            <button
                                onclick={zoomOut}
                                class="flex items-center gap-1 text-[9px] text-violet-600 hover:text-violet-300 transition-colors"
                            >
                                <ZoomOut size={10} />
                                Zoom Out
                            </button>
                        {/if}
                    </div>
                    <div class="flex-1 overflow-y-auto p-2">
                        <PolisherTree
                            node={viewRoot}
                            {activeNodeId}
                            onSelect={selectNode}
                            onFocus={focusNode}
                        />
                    </div>
                </div>
            {/if}

            <!-- Pane 2: Facets (middle) -->
            <div class="flex-1 flex flex-col min-h-0 bg-[#030008] border-r border-violet-800/30">
                <div class="px-4 py-2 border-b border-violet-900/30 flex items-center justify-between">
                    <div>
                        <span class="text-[9px] uppercase tracking-widest text-violet-600 font-bold">Facets</span>
                        {#if activeNode.parentId !== null}
                            <span class="text-[9px] text-violet-800 ml-2">
                                from: {activeNode.text ? activeNode.text.slice(0, 30) + '...' : 'node'}
                            </span>
                        {/if}
                    </div>
                    <span class="text-[9px] text-violet-800">Click Use or Drill to branch deeper</span>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-3">
                    {#each displayFacets as gen, i}
                        <div class="group border border-violet-800/30 bg-black/40 rounded-lg overflow-hidden hover:border-violet-600/50 transition-colors">
                            <div class="flex items-center justify-between px-3 py-1.5 border-b border-violet-900/20 bg-violet-950/20">
                                <span class="text-[9px] uppercase tracking-widest text-violet-600 font-bold">
                                    Facet {i + 1}
                                </span>
                                <div class="flex gap-1.5">
                                    {#if !isGenerating && activeNode.children[i]}
                                        <button
                                            onclick={() => drillInto(i)}
                                            class="text-[9px] uppercase tracking-widest text-violet-700 hover:text-violet-300 transition-colors px-2 py-0.5 border border-transparent hover:border-violet-700/50 rounded"
                                        >
                                            Drill
                                        </button>
                                    {/if}
                                    <button
                                        onclick={() => useGeneration(i)}
                                        disabled={!gen}
                                        class="text-[9px] uppercase tracking-widest text-violet-500 hover:text-violet-200 disabled:opacity-30 transition-colors px-2 py-0.5 border border-transparent hover:border-violet-700/50 rounded"
                                    >
                                        Use
                                    </button>
                                </div>
                            </div>
                            <div class="px-4 py-3 text-sm leading-relaxed text-violet-200/90 font-sans max-h-[30vh] overflow-y-auto whitespace-pre-wrap">
                                {#if gen}
                                    {gen}
                                {:else if isGenerating}
                                    <span class="flex items-center gap-2 text-violet-700 text-xs">
                                        <Loader2 size={12} class="animate-spin" />
                                        Streaming...
                                    </span>
                                {:else}
                                    <span class="text-violet-800 text-xs italic">No output</span>
                                {/if}
                            </div>
                        </div>
                    {/each}

                    {#if error}
                        <div class="border border-red-800/50 bg-red-950/20 rounded-lg px-4 py-3 text-xs text-red-400">
                            {error}
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Pane 3: Polishing Wheel (right) -->
            <div class="w-[35%] shrink-0 flex flex-col min-h-0 bg-[#020005]">
                <div class="px-4 py-2 border-b border-cyan-900/30 flex items-center justify-between">
                    <div>
                        <span class="text-[9px] uppercase tracking-widest text-cyan-600 font-bold">Polishing Wheel</span>
                        <span class="text-[9px] text-cyan-800 ml-2">Mix, edit, and refine</span>
                    </div>
                    <span class="text-[9px] text-cyan-700 font-mono">
                        {polishedText.trim().split(/\s+/).filter(w => w.length > 0).length} words
                    </span>
                </div>
                <textarea
                    bind:this={polishAreaRef}
                    bind:value={polishedText}
                    class="teal-scrollbar flex-1 resize-none bg-transparent p-5 text-[15px] leading-relaxed text-violet-100 outline-none placeholder:text-cyan-900 font-sans"
                    placeholder="Select facets to import text here, then mix and refine your final version..."
                    spellcheck="false"
                ></textarea>
                <div class="flex items-center justify-between px-4 py-3 border-t border-cyan-800/30 bg-black/40">
                    <button
                        onclick={onClose}
                        class="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-600 hover:text-cyan-300 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onclick={handleApply}
                        disabled={!polishedText.trim()}
                        class="flex items-center gap-2 border border-cyan-500/60 bg-cyan-900/30 px-5 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-700/40 hover:border-cyan-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-md shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                    >
                        <Check size={12} />
                        Apply Polish
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>
