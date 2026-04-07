<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { invoke } from '@tauri-apps/api/core';
    import type { FsTimeline, FsTimelineEvent } from '$lib/agents/fs-db';
    import { X } from 'lucide-svelte';

    const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#e11d48", "#f59e0b"];

    let { nodeId, timelineId, onClose, onUpdate } = $props<{
        nodeId: string;
        timelineId: string;
        onClose: () => void;
        onUpdate: () => void;
    }>();

    let title = $state('');
    let content = $state('');
    let summary = $state('');
    let color = $state('#8b5cf6');
    let nodeType = $state('Event');
    let passFullContent = $state(false);
    let referenceType = $state<string | null>(null);
    let referenceId = $state<string | null>(null);
    let isLoading = $state(true);

    $effect(() => {
        loadNode(nodeId);
    });

    async function loadNode(nid: string) {
        isLoading = true;
        const tl = appState.timelines.find(t => t.id === timelineId);
        if (!tl) { isLoading = false; return; }
        const node = tl.events.find(e => e.id === nid);
        if (!node) { isLoading = false; return; }
        title = node.title || '';
        content = node.content || '';
        summary = node.summary || '';
        color = node.color || '#8b5cf6';
        nodeType = node.nodeType || 'Event';
        passFullContent = node.passFullContent || false;
        referenceType = node.referenceType || null;
        referenceId = node.referenceId || null;
        isLoading = false;
    }

    async function handleSave(updates: Partial<FsTimelineEvent>) {
        const tl = appState.timelines.find(t => t.id === timelineId);
        if (!tl || !appState.activeProjectId) return;
        const idx = tl.events.findIndex(e => e.id === nodeId);
        if (idx === -1) return;
        const updated: FsTimeline = {
            ...tl,
            updatedAt: new Date().toISOString(),
            events: tl.events.map((e, i) => i === idx ? { ...e, ...updates } : e)
        };
        await invoke('write_timeline', { projectId: appState.activeProjectId, timeline: updated });
        await appState.reloadProjectData();
        onUpdate();
    }

    function handleColorChange(c: string) {
        color = c;
        handleSave({ color: c });
    }

    let saveDebounce: ReturnType<typeof setTimeout>;
    function debouncedSaveField(field: string, value: any) {
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(() => handleSave({ [field]: value }), 400);
    }
</script>

<div class="absolute right-0 top-0 bottom-0 w-80 bg-[#050308] border-l border-violet-800/60 z-40 flex flex-col overflow-y-auto">
    <div class="flex items-center justify-between px-3 py-2 border-b border-violet-800/60">
        <span class="text-[10px] uppercase tracking-[0.2em] text-violet-400 font-bold">Facet Editor</span>
        <button onclick={onClose} class="text-violet-500 hover:text-violet-200 transition-colors"><X size={14} /></button>
    </div>

    {#if isLoading}
        <div class="p-4 text-violet-600 text-xs">Loading...</div>
    {:else}
        <div class="p-3 flex flex-col gap-3 text-xs">
            <div class="flex flex-col gap-1">
                <label for="ne-title" class="text-[10px] text-violet-600 uppercase tracking-widest">Title</label>
                <input
                    id="ne-title"
                    class="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none text-xs rounded-md"
                    bind:value={title}
                    oninput={() => debouncedSaveField('title', title)}
                />
            </div>

            <div class="flex flex-col gap-1">
                <label for="ne-type" class="text-[10px] text-violet-600 uppercase tracking-widest">Node Type</label>
                <select
                    id="ne-type"
                    class="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none uppercase text-[10px] rounded-md"
                    bind:value={nodeType}
                    onchange={() => handleSave({ nodeType })}
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

            <div class="flex flex-col gap-1">
                <label class="flex items-center gap-2 cursor-pointer text-violet-400 hover:text-violet-300">
                    <input
                        type="checkbox"
                        class="accent-violet-500"
                        bind:checked={passFullContent}
                        onchange={() => handleSave({ passFullContent })}
                    />
                    <span class="text-[10px] uppercase tracking-widest font-bold">Inject Full Content Downstream</span>
                </label>
            </div>

            <div class="flex flex-col gap-1">
                <span class="text-[10px] text-violet-600 uppercase tracking-widest">Color Variant</span>
                <div class="flex gap-2">
                    {#each COLORS as c}
                        <button
                            onclick={() => handleColorChange(c)}
                            class="w-6 h-6 border rounded-sm transition-all"
                            style="background-color: {c}; border-color: {color === c ? '#fff' : c + '66'}; {color === c ? 'box-shadow: 0 0 8px ' + c : ''}"
                            aria-label="Set color to {c}"
                        ></button>
                    {/each}
                </div>
            </div>

            <div class="flex flex-col gap-1">
                <label for="ne-summary" class="text-[10px] text-violet-600 uppercase tracking-widest">Summary</label>
                <textarea
                    id="ne-summary"
                    class="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none text-xs resize-y min-h-[60px] rounded-md"
                    bind:value={summary}
                    oninput={() => debouncedSaveField('summary', summary)}
                    rows="3"
                ></textarea>
            </div>

            <div class="flex flex-col gap-1">
                <label for="ne-content" class="text-[10px] text-violet-600 uppercase tracking-widest">Content</label>
                <textarea
                    id="ne-content"
                    class="bg-black border border-violet-900/50 p-2 text-violet-200 focus:border-violet-500 outline-none text-xs resize-y min-h-[120px] font-mono rounded-md"
                    bind:value={content}
                    oninput={() => debouncedSaveField('content', content)}
                    rows="8"
                ></textarea>
            </div>

            {#if referenceType}
                <div class="text-[10px] text-violet-600 border-t border-violet-900/50 pt-2 mt-1">
                    <span class="uppercase tracking-widest">Linked: </span>
                    <span class="text-violet-300">[{referenceType.toUpperCase()}] {referenceId}</span>
                </div>
            {/if}

            <div class="flex gap-2 mt-2">
                <button
                    class="flex-1 border border-violet-800/60 bg-violet-950/40 px-2 py-1.5 text-[10px] uppercase tracking-widest text-violet-300 hover:bg-violet-900/40 transition-colors rounded-md"
                    onclick={async () => {
                        if (!appState.activeProjectId) return;
                        await invoke('create_file', { projectId: appState.activeProjectId, folderId: null, name: title || 'Exported Node', type: 'wiki' });
                        await appState.reloadProjectData();
                    }}
                >Export to Wiki</button>
                <button
                    class="flex-1 border border-violet-800/60 bg-violet-950/40 px-2 py-1.5 text-[10px] uppercase tracking-widest text-violet-300 hover:bg-violet-900/40 transition-colors rounded-md"
                    onclick={async () => {
                        if (!appState.activeProjectId) return;
                        await invoke('create_file', { projectId: appState.activeProjectId, folderId: null, name: title || 'Exported Node', type: 'document' });
                        await appState.reloadProjectData();
                    }}
                >Export to Crystal</button>
            </div>
        </div>
    {/if}
</div>
