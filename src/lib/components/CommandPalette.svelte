<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { onMount, onDestroy } from 'svelte';
    import { slide, fade, fly } from 'svelte/transition';
    import { backOut } from 'svelte/easing';
    import { Search, FileText, Database, Clock } from 'lucide-svelte';

    let open = $state(false);
    let query = $state('');
    let selectedIndex = $state(0);

    const handleKeydown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            open = !open;
            query = '';
            selectedIndex = 0;
        } else if (e.key === 'Escape' && open) {
            open = false;
        } else if (open) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % results.length;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + results.length) % results.length;
            } else if (e.key === 'Enter' && results.length > 0) {
                e.preventDefault();
                handleSelect(results[selectedIndex]);
            }
        }
    };

    onMount(() => {
        window.addEventListener('keydown', handleKeydown);
    });

    onDestroy(() => {
        window.removeEventListener('keydown', handleKeydown);
    });

    let results = $derived.by(() => {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        
        const docs = appState.documents.filter(d => d.title.toLowerCase().includes(q)).map(d => ({ type: 'document', ...d }));
        const wikis = appState.wikiEntries.filter(w => w.title.toLowerCase().includes(q)).map(w => ({ type: 'wiki', ...w }));
        const tls = appState.timelines.filter(t => t.title.toLowerCase().includes(q)).map(t => ({ type: 'timeline', ...t }));
        
        return [...docs, ...wikis, ...tls];
    });

    let inputEl = $state<HTMLInputElement | null>(null);

    $effect(() => {
        // Focus input when opened
        if (open) {
            // Need a slight tick to allow DOM to render before focusing
            setTimeout(() => inputEl?.focus(), 10);
        }
    });

    $effect(() => {
        // Reset selected index when query changes
        query;
        selectedIndex = 0;
    });

    function handleSelect(item: any) {
        appState.navigateTo({ type: item.type, id: item.id });
        open = false;
    }
</script>

{#if open}
    <div class="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]" transition:fade={{ duration: 150 }}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="absolute inset-0" onclick={() => open = false}></div>
        
        <div 
            class="relative w-full max-w-xl bg-[#050308] border border-violet-500/50 shadow-[0_0_50px_rgba(139,92,246,0.3)] rounded-lg flex flex-col max-h-[60vh] overflow-hidden"
            transition:fly={{ duration: 300, y: -20, easing: backOut }}
        >
            <div class="flex items-center px-4 border-b border-violet-900/60 bg-black/40">
                <Search size={16} class="text-violet-500" />
                <input 
                    bind:this={inputEl}
                    type="text"
                    bind:value={query}
                    placeholder="Search crystals, artifacts, veins..."
                    class="w-full bg-transparent border-none outline-none text-violet-100 p-4 font-mono text-sm placeholder:text-violet-800"
                />
            </div>
            
            <div class="flex-1 overflow-y-auto">
                {#if query.trim() && results.length === 0}
                    <div class="p-8 text-center text-violet-500/50 font-mono text-sm uppercase tracking-widest">
                        No results found
                    </div>
                {/if}
                
                {#each results as item, i}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_interactive_supports_focus -->
                    <div 
                        role="button"
                        class="flex items-center gap-3 p-3 border-b border-violet-900/20 cursor-pointer transition-colors {i === selectedIndex ? 'bg-violet-900/40 border-l-2 border-l-violet-400' : 'hover:bg-violet-900/20'}"
                        onclick={() => handleSelect(item)}
                        onmousemove={() => selectedIndex = i}
                    >
                        {#if item.type === 'document'}
                            <FileText size={14} class="text-amber-500" />
                        {:else if item.type === 'wiki'}
                            <Database size={14} class="text-cyan-500" />
                        {:else}
                            <Clock size={14} class="text-violet-500" />
                        {/if}
                        
                        <div class="flex-1 flex flex-col">
                            <span class="text-violet-200 font-bold font-mono">{item.title}</span>
                            <span class="text-[9px] uppercase tracking-widest text-violet-600">
                                {item.type === 'document' ? 'Crystal' : item.type === 'wiki' ? 'Artifact' : 'Vein'}
                            </span>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    </div>
{/if}