<script lang="ts">
    import { ChevronRight, ChevronDown, Focus, Gem } from 'lucide-svelte';
    import type { GemNode } from '$lib/polisher/types';

    let {
        node,
        activeNodeId,
        depth = 0,
        onSelect,
        onFocus,
    } = $props<{
        node: GemNode;
        activeNodeId: string;
        depth?: number;
        onSelect: (id: string) => void;
        onFocus: (id: string) => void;
    }>();

    let expanded = $state(true);
    const isActive = $derived(node.id === activeNodeId);
    const hasChildren = $derived(node.children.length > 0);
    const truncated = $derived(
        node.text
            ? (node.text.length > 50 ? node.text.slice(0, 50) + '...' : node.text)
            : (node.parentId === null ? 'Root' : 'Empty')
    );
</script>

<div class="select-none" style="padding-left: {depth * 12}px">
    <!-- Node row -->
    <div
        class="group flex items-center gap-1 py-1 px-1.5 rounded cursor-pointer transition-colors
            {isActive ? 'bg-cyan-900/40 border border-cyan-600/50' : 'border border-transparent hover:bg-cyan-950/40 hover:border-cyan-800/30'}"
        role="button"
        tabindex="0"
        onclick={() => onSelect(node.id)}
        onkeydown={(e) => { if (e.key === 'Enter') onSelect(node.id); }}
    >
        <!-- Expand/collapse toggle -->
        {#if hasChildren}
            <button
                class="p-0.5 text-cyan-700 hover:text-cyan-400 transition-colors shrink-0"
                onclick={(e) => { e.stopPropagation(); expanded = !expanded; }}
            >
                {#if expanded}
                    <ChevronDown size={10} />
                {:else}
                    <ChevronRight size={10} />
                {/if}
            </button>
        {:else}
            <span class="w-[14px] shrink-0"></span>
        {/if}

        <!-- Node icon -->
        <Gem size={9} class="{isActive ? 'text-cyan-400' : 'text-cyan-800'} shrink-0" />

        <!-- Node text preview -->
        <span class="text-[9px] font-mono truncate {isActive ? 'text-cyan-200' : 'text-cyan-600'}">
            {truncated}
        </span>

        <!-- Child count badge -->
        {#if hasChildren}
            <span class="text-[8px] text-cyan-800 font-mono ml-auto shrink-0">
                {node.children.length}
            </span>
        {/if}

        <!-- Focus/zoom button -->
        <button
            class="p-0.5 text-cyan-800 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
            onclick={(e) => { e.stopPropagation(); onFocus(node.id); }}
            title="Focus on this branch"
        >
            <Focus size={10} />
        </button>
    </div>

    <!-- Children (recursive) -->
    {#if expanded && hasChildren}
        <div>
            {#each node.children as child (child.id)}
                <svelte:self
                    node={child}
                    {activeNodeId}
                    depth={depth + 1}
                    {onSelect}
                    {onFocus}
                />
            {/each}
        </div>
    {/if}
</div>
