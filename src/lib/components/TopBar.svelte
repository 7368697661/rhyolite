<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { Globe, Activity, Database, FileText, GitBranch } from 'lucide-svelte';

    let veinsCount = $derived(appState.timelines.length);
    let crystalsCount = $derived(appState.documents.length);
    let artifactsCount = $derived(appState.wikiEntries.length);
</script>

<div class="h-12 border-b border-violet-900/30 bg-[#050308]/90 flex items-center justify-between px-4 sticky top-0 z-50 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
    <div class="flex items-center gap-4">
        <div class="font-heading text-xl text-violet-400 font-bold tracking-widest flex items-center">
            R//<span class="inline-block w-[10px] h-[18px] bg-violet-400 ml-0.5 animate-blink"></span>
        </div>
    </div>

    <div class="flex items-center gap-6 font-mono text-xs text-violet-400/70">
        <div class="flex items-center gap-2 group cursor-default transition-colors hover:text-violet-300">
            <GitBranch size={14} />
            <span>VENS: <span class="text-violet-200">{veinsCount}</span></span>
        </div>
        <div class="flex items-center gap-2 group cursor-default transition-colors hover:text-violet-300">
            <FileText size={14} />
            <span>CRYS: <span class="text-violet-200">{crystalsCount}</span></span>
        </div>
        <div class="flex items-center gap-2 group cursor-default transition-colors hover:text-violet-300">
            <Database size={14} />
            <span>ARTS: <span class="text-violet-200">{artifactsCount}</span></span>
        </div>
    </div>

    <div class="flex items-center gap-3">
        <button 
            class="flex items-center gap-2 text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded bg-violet-900/20 text-violet-300 border border-violet-500/20 hover:bg-violet-900/40 hover:border-violet-500/40 transition-all"
            onclick={() => appState.showDocs = true}
            title="Open Documentation"
        >
            <span>[ Docs ]</span>
        </button>
        <button 
            class="flex items-center gap-2 text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded bg-violet-900/20 text-violet-300 border border-violet-500/20 hover:bg-violet-900/40 hover:border-violet-500/40 transition-all"
            onclick={() => appState.navigateTo({ type: 'network', id: 'global-map' })}
        >
            <Globe size={14} />
            <span>Quarry</span>
        </button>
    </div>
</div>
