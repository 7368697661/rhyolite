<script lang="ts">
    import { X, Gem, RotateCw, Check, Loader2 } from 'lucide-svelte';
    import { fade, scale } from 'svelte/transition';
    import { backOut } from 'svelte/easing';
    import { executePolisherGeneration } from '$lib/agents/infill';
    import { tick } from 'svelte';

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

    let generations = $state<string[]>(["", "", ""]);
    let isGenerating = $state(false);
    let polishedText = $state("");
    let error = $state<string | null>(null);
    let abortController = $state<AbortController | null>(null);
    let polishAreaRef = $state<HTMLTextAreaElement | null>(null);

    const isRewrite = selectedText.length > 0;
    const modeLabel = isRewrite ? "Rewriting selection" : "Forward-generating";

    // Auto-generate on mount
    $effect(() => {
        generate();
        return () => {
            abortController?.abort();
        };
    });

    async function generate() {
        abortController?.abort();
        const ac = new AbortController();
        abortController = ac;
        isGenerating = true;
        error = null;
        generations = ["", "", ""];

        try {
            await executePolisherGeneration({
                projectId,
                selectedText,
                fullContent,
                cursorPos,
                abortSignal: ac.signal,
                count: 3,
                onDelta: (index, delta) => {
                    generations[index] += delta;
                },
            });
        } catch (e: any) {
            if (e?.name !== "AbortError") {
                error = e?.message || String(e);
            }
        } finally {
            isGenerating = false;
        }
    }

    function useGeneration(index: number) {
        polishedText += (polishedText ? "\n" : "") + generations[index];
        tick().then(() => {
            if (polishAreaRef) {
                polishAreaRef.scrollTop = polishAreaRef.scrollHeight;
            }
        });
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
        class="flex h-[85vh] w-[95vw] max-w-6xl flex-col border border-cyan-600/50 bg-[#020005] shadow-2xl shadow-cyan-900/20 rounded-lg overflow-hidden"
        onclick={(e) => e.stopPropagation()}
        transition:scale={{ duration: 300, start: 0.95, easing: backOut }}
    >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-cyan-700/40 px-5 py-3 bg-black/60">
            <div class="flex items-center gap-3">
                <Gem size={16} class="text-cyan-400" />
                <h2 class="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                    The Polisher
                </h2>
                <span class="text-[9px] uppercase tracking-widest text-cyan-600 border border-cyan-800/50 px-2 py-0.5 rounded">
                    {modeLabel}
                </span>
            </div>
            <div class="flex items-center gap-2">
                <button
                    onclick={generate}
                    disabled={isGenerating}
                    class="flex items-center gap-1.5 border border-cyan-700/60 bg-cyan-950/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:border-cyan-500 hover:text-cyan-100 transition-colors rounded-md disabled:opacity-50"
                >
                    <RotateCw size={11} class={isGenerating ? "animate-spin" : ""} />
                    {isGenerating ? "Generating..." : "Generate More"}
                </button>
                <button
                    onclick={onClose}
                    class="border border-cyan-800/60 bg-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-cyan-400 hover:border-cyan-600 hover:text-cyan-200 rounded-md transition-colors"
                >
                    <X size={12} />
                </button>
            </div>
        </div>

        <!-- Body -->
        <div class="flex flex-1 min-h-0 divide-x divide-cyan-800/30">
            <!-- Left Column: Generation Cards -->
            <div class="w-[55%] flex flex-col min-h-0 bg-[#030008]">
                <div class="px-4 py-2 border-b border-cyan-900/30">
                    <span class="text-[9px] uppercase tracking-widest text-cyan-600 font-bold">Facets</span>
                    <span class="text-[9px] text-cyan-800 ml-2">Click a card to add it to the polishing wheel</span>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-3">
                    {#each generations as gen, i}
                        <div class="group border border-cyan-800/30 bg-black/40 rounded-lg overflow-hidden hover:border-cyan-600/50 transition-colors">
                            <div class="flex items-center justify-between px-3 py-1.5 border-b border-cyan-900/20 bg-cyan-950/20">
                                <span class="text-[9px] uppercase tracking-widest text-cyan-600 font-bold">
                                    Facet {i + 1}
                                </span>
                                <div class="flex gap-1.5">
                                    <button
                                        onclick={() => useGeneration(i)}
                                        disabled={!gen}
                                        class="text-[9px] uppercase tracking-widest text-cyan-500 hover:text-cyan-200 disabled:opacity-30 transition-colors px-2 py-0.5 border border-transparent hover:border-cyan-700/50 rounded"
                                    >
                                        Use
                                    </button>
                                </div>
                            </div>
                            <div class="px-4 py-3 text-sm leading-relaxed text-violet-200/90 font-sans max-h-[30vh] overflow-y-auto whitespace-pre-wrap">
                                {#if gen}
                                    {gen}
                                {:else if isGenerating}
                                    <span class="flex items-center gap-2 text-cyan-700 text-xs">
                                        <Loader2 size={12} class="animate-spin" />
                                        Streaming...
                                    </span>
                                {:else}
                                    <span class="text-cyan-800 text-xs italic">No output</span>
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

            <!-- Right Column: Polishing Wheel -->
            <div class="w-[45%] flex flex-col min-h-0 bg-[#020005]">
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
                    class="flex-1 resize-none bg-transparent p-5 text-[15px] leading-relaxed text-violet-100 outline-none placeholder:text-cyan-900 font-sans"
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
