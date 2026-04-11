<script lang="ts">
    import { appState, type Glyph } from '$lib/state.svelte';
    import { invoke } from '@tauri-apps/api/core';
    import { Plus, Trash2, Bot } from 'lucide-svelte';

    let selectedGlyphId = $state<string | null>(null);

    let activeGlyph = $derived.by(() => {
        if (!selectedGlyphId && appState.glyphs.length > 0) {
            return appState.glyphs[0];
        }
        return appState.glyphs.find(g => g.id === selectedGlyphId) || null;
    });

    // Form states
    let name = $state('');
    let model = $state('gemini-1.5-pro');
    let temperature = $state(0.7);
    let outputLength = $state(2048);
    let isSculpter = $state(false);
    let role = $state('');
    let specialistRole = $state('');
    let isCompletionModel = $state(false);
    let isPolisherEngine = $state(false);
    let pipelineStr = $state('');

    // Sync form with active glyph only when the selected glyph changes
    let currentGlyphId = $state<string | null>(null);

    $effect(() => {
        const id = activeGlyph?.id || null;
        if (id !== currentGlyphId) {
            currentGlyphId = id;
            if (activeGlyph) {
                name = activeGlyph.name;
                model = activeGlyph.model;
                temperature = activeGlyph.temperature;
                outputLength = activeGlyph.outputLength;
                isSculpter = activeGlyph.isSculpter;
                role = activeGlyph.role;
                specialistRole = activeGlyph.specialistRole || '';
                isCompletionModel = activeGlyph.isCompletionModel || false;
                isPolisherEngine = activeGlyph.isPolisherEngine || false;
                pipelineStr = (activeGlyph.pipeline || []).join(', ');
            } else {
                name = '';
                model = 'gemini-1.5-pro';
                temperature = 0.7;
                outputLength = 2048;
                isSculpter = false;
                role = '';
                specialistRole = '';
                isCompletionModel = false;
                isPolisherEngine = false;
                pipelineStr = '';
            }
        }
    });

    async function handleSave() {
        if (!activeGlyph) return;
        const updated: Glyph = {
            id: activeGlyph.id,
            name,
            model,
            temperature,
            outputLength,
            isSculpter,
            role,
            specialistRole: specialistRole || undefined,
            isCompletionModel: isCompletionModel || undefined,
            isPolisherEngine: isPolisherEngine || undefined,
            pipeline: pipelineStr ? pipelineStr.split(',').map(s => s.trim()).filter(Boolean) : undefined
        };
        
        // Optimistically update local state so UI doesn't reset mid-typing
        const idx = appState.glyphs.findIndex(g => g.id === activeGlyph!.id);
        if (idx !== -1) {
            appState.glyphs[idx] = updated;
        }

        await invoke('save_glyph', { glyph: updated });
    }

    async function createNew() {
        const id = `glyph_${Date.now()}`;
        const newGlyph: Glyph = {
            id,
            name: 'New Glyph',
            model: 'gemini-1.5-pro',
            temperature: 0.7,
            outputLength: 2048,
            isSculpter: false,
            role: 'You are a helpful assistant.'
        };
        await invoke('save_glyph', { glyph: newGlyph });
        appState.glyphs = await invoke<Glyph[]>('list_glyphs') || [];
        selectedGlyphId = id;
    }

    async function handleDelete(id: string) {
        if (!confirm("Delete this Glyph?")) return;
        await invoke('delete_glyph', { id });
        appState.glyphs = await invoke<Glyph[]>('list_glyphs') || [];
        if (selectedGlyphId === id) selectedGlyphId = null;
    }
</script>

<div class="flex-1 flex flex-col h-full bg-[#050308] overflow-hidden">
    <!-- Header -->
    <div class="p-8 border-b border-violet-900/40 bg-[#020005]">
        <h1 class="text-3xl text-violet-100 font-bold font-heading uppercase tracking-widest flex items-center gap-4">
            <Bot size={32} class="text-violet-500" />
            Glyph Registry
        </h1>
        <p class="text-violet-400 mt-2 font-mono text-xs uppercase tracking-widest">
            Configure sculptors and chisels for carving your world.
        </p>
    </div>

    <div class="flex-1 flex min-h-0 divide-x divide-violet-900/40">
        <!-- Sidebar: List of Glyphs -->
        <div class="w-64 bg-[#020005] overflow-y-auto p-4 flex flex-col gap-2">
            <button 
                onclick={createNew}
                class="w-full py-2 px-3 flex items-center justify-center gap-2 border border-violet-500/40 text-violet-300 font-bold text-xs uppercase tracking-widest rounded-lg hover:bg-violet-900/30 hover:border-violet-500 transition-colors mb-4"
            >
                <Plus size={14} /> New Glyph
            </button>

            {#each appState.glyphs as glyph}
                <div 
                    class="w-full text-left group flex items-center justify-between px-3 py-2 border border-violet-700/30 bg-violet-950/20 rounded-lg cursor-pointer hover:bg-violet-900/30 transition-colors {activeGlyph?.id === glyph.id ? 'border-violet-500 bg-violet-900/40' : ''}" 
                    role="button"
                    tabindex="0"
                    onclick={() => selectedGlyphId = glyph.id}
                    onkeydown={(e) => { if (e.key === 'Enter') selectedGlyphId = glyph.id; }}
                >
                    <div class="flex items-center gap-2 font-mono text-xs text-violet-100 truncate">
                        <Bot size={12} class="text-violet-500" />
                        <span class="truncate">{glyph.name}</span>
                        {#if glyph.specialistRole && !glyph.isSculpter}
                            <span class="px-1.5 py-0.5 rounded border border-violet-500/50 bg-violet-500/20 text-violet-300 text-[9px] uppercase tracking-widest ml-2 flex-shrink-0">
                                {glyph.specialistRole}
                            </span>
                        {/if}
                    </div>
                    <button 
                        class="text-red-500/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-1"
                        onclick={(e) => { e.stopPropagation(); handleDelete(glyph.id); }}
                        aria-label="Delete Glyph"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            {/each}
        </div>

        <!-- Editor Pane -->
        <div class="flex-1 overflow-y-auto p-8 font-mono text-sm text-violet-200">
            {#if activeGlyph}
                <div class="max-w-2xl mx-auto space-y-8">
                    <!-- Basic Info -->
                    <div class="grid grid-cols-2 gap-6">
                        <div class="space-y-2 col-span-2">
                            <label for="glyph-name" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">Designation (Name)</label>
                            <input 
                                id="glyph-name"
                                type="text" 
                                bind:value={name}
                                oninput={handleSave}
                                class="w-full bg-[#020005] border border-violet-700/40 rounded-lg px-4 py-2 text-violet-100 outline-none focus:border-violet-500 focus:shadow-[0_0_15px_rgba(139,92,246,0.2)] transition-all"
                            />
                        </div>

                        <div class="space-y-2">
                            <label for="glyph-model" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">Model Kernel</label>
                            <input 
                                id="glyph-model"
                                type="text"
                                bind:value={model}
                                oninput={handleSave}
                                placeholder="e.g. gemini-1.5-pro"
                                class="w-full bg-[#020005] border border-violet-700/40 rounded-lg px-4 py-2 text-violet-100 outline-none focus:border-violet-500 transition-all"
                            />
                        </div>

                        <div class="space-y-2">
                            <label for="glyph-temp" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold flex justify-between">
                                <span>Temperature</span>
                                <span>{temperature.toFixed(2)}</span>
                            </label>
                            <input 
                                id="glyph-temp"
                                type="range" 
                                min="0" max="2" step="0.05"
                                bind:value={temperature}
                                onchange={handleSave}
                                class="w-full accent-violet-500"
                            />
                        </div>

                        <div class="space-y-2">
                            <label for="glyph-tokens" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold flex justify-between items-center">
                                <span>Output Length (Tokens)</span>
                                <input 
                                    type="number"
                                    bind:value={outputLength}
                                    oninput={handleSave}
                                    class="bg-transparent border-b border-violet-900/60 w-16 text-right outline-none focus:border-violet-500 text-violet-100"
                                />
                            </label>
                            <input 
                                id="glyph-tokens"
                                type="range" 
                                min="256" max="8192" step="256"
                                bind:value={outputLength}
                                onchange={handleSave}
                                class="w-full accent-violet-500"
                            />
                        </div>

                        <div class="space-y-2 flex items-center pt-6">
                            <label class="flex items-center gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    bind:checked={isSculpter}
                                    onchange={handleSave}
                                    class="w-4 h-4 bg-[#020005] border border-violet-900 rounded checked:bg-violet-500 appearance-none flex items-center justify-center after:content-[''] after:w-2 after:h-2 after:bg-white after:rounded-sm after:hidden checked:after:block outline-none"
                                />
                                <span class="text-xs uppercase tracking-widest text-violet-300 group-hover:text-violet-100 transition-colors">Sculptor (Show in Studio)</span>
                            </label>
                        </div>

                        <div class="space-y-2 flex items-center pt-6">
                            <label class="flex items-center gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    bind:checked={isCompletionModel}
                                    onchange={handleSave}
                                    class="w-4 h-4 bg-[#020005] border border-violet-900 rounded checked:bg-amber-500 appearance-none flex items-center justify-center after:content-[''] after:w-2 after:h-2 after:bg-white after:rounded-sm after:hidden checked:after:block outline-none"
                                />
                                <span class="text-xs uppercase tracking-widest text-violet-300 group-hover:text-violet-100 transition-colors">Completion Engine (Raw Prompt)</span>
                            </label>
                        </div>

                        <div class="space-y-2 flex items-center pt-6 col-span-2">
                            <label class="flex items-center gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    bind:checked={isPolisherEngine}
                                    onchange={handleSave}
                                    class="w-4 h-4 bg-[#020005] border border-violet-900 rounded checked:bg-cyan-500 appearance-none flex items-center justify-center after:content-[''] after:w-2 after:h-2 after:bg-white after:rounded-sm after:hidden checked:after:block outline-none"
                                />
                                <span class="text-xs uppercase tracking-widest text-violet-300 group-hover:text-violet-100 transition-colors">Polisher Engine (Multi-Gen Refining)</span>
                            </label>
                        </div>

                        {#if !isSculpter}
                        <div class="space-y-2 col-span-2 border-t border-violet-900/40 pt-4 mt-2">
                            <label for="glyph-specialist-role" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">Chisel Tag</label>
                            <div class="flex gap-4 items-center">
                                <select 
                                    id="glyph-specialist-role"
                                    bind:value={specialistRole}
                                    onchange={handleSave}
                                    class="flex-1 bg-[#020005] border border-violet-700/40 rounded-lg px-4 py-2 text-violet-100 outline-none focus:border-violet-500 transition-all font-mono text-xs appearance-none"
                                >
                                    <option value="">-- None --</option>
                                    <option value="researcher">Researcher</option>
                                    <option value="writer">Writer</option>
                                    <option value="auditor">Auditor</option>
                                    <option value="architect">Architect</option>
                                    <option value="analyst">Analyst</option>
                                </select>
                                <div class="text-[9px] text-violet-400/80 w-1/2 leading-relaxed">
                                    Sculptors delegate work to chisels tagged with the required <span class="text-violet-300">researcher</span>, <span class="text-violet-300">writer</span>, or <span class="text-violet-300">auditor</span> role during multi-step carving sessions.
                                </div>
                            </div>
                        </div>
                        {:else}
                        <div class="space-y-2 col-span-2 border-t border-violet-900/40 pt-4 mt-2">
                            <label for="glyph-pipeline" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">Research Pipeline</label>
                            <div class="flex gap-4 items-center">
                                <input 
                                    id="glyph-pipeline"
                                    type="text"
                                    bind:value={pipelineStr}
                                    oninput={handleSave}
                                    placeholder="e.g. researcher, writer, auditor"
                                    class="flex-1 bg-[#020005] border border-violet-700/40 rounded-lg px-4 py-2 text-violet-100 outline-none focus:border-violet-500 transition-all font-mono text-xs"
                                />
                                <div class="text-[9px] text-violet-400/80 w-1/2 leading-relaxed">
                                    Comma-separated list of chisel tags to run sequentially during <span class="text-violet-300">Research</span> mode.
                                </div>
                            </div>
                        </div>
                        {/if}
                    </div>

                    <!-- Role / Prompt -->
                    <div class="space-y-2">
                        <label for="glyph-role" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">Chisel Role (System Prompt)</label>
                        <textarea 
                            id="glyph-role"
                            bind:value={role}
                            oninput={handleSave}
                            rows="10"
                            class="w-full bg-[#020005] border border-violet-700/40 rounded-lg px-4 py-3 text-violet-100 outline-none focus:border-violet-500 focus:shadow-[0_0_15px_rgba(139,92,246,0.2)] transition-all resize-none leading-relaxed"
                            placeholder="You are a chisel specializing in..."
                        ></textarea>
                    </div>

                </div>
            {:else}
                <div class="h-full flex flex-col items-center justify-center opacity-50 space-y-4">
                    <Bot size={48} class="text-violet-700" />
                    <p class="uppercase tracking-widest text-xs">No Glyph Selected</p>
                </div>
            {/if}
        </div>
    </div>
</div>