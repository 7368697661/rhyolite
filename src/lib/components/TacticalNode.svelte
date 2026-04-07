<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';

    let { data, selected } = $props<{ data: any, selected: boolean }>();
    let customColor = $derived(data.color || '#8b5cf6');
</script>

<div
    class="bg-[#0a0514] border p-3 min-w-[200px] font-mono text-[10px] uppercase tracking-widest text-violet-300 relative transition-all rounded-lg"
    style="border-color: {selected ? '#c4b5fd' : customColor}; box-shadow: {selected ? `0 0 20px ${customColor}80` : `0 0 15px ${customColor}26`};"
>
    <Handle
        type="target"
        position={Position.Top}
        class="!w-3 !h-3 !border-none !rounded-none"
        style="background-color: {customColor}"
    />

    <div class="flex items-center justify-between mb-2 pb-1 border-b" style="border-color: {customColor}99">
        <span class="font-bold" style="color: {customColor}">
            &gt; {data.nodeType ? data.nodeType.toUpperCase() : 'EVT_NODE'}
        </span>
    </div>

    <div class="font-bold text-violet-200 mb-2 truncate">
        {data.label || '[ NO_TITLE ]'}
    </div>

    {#if data.summary}
        <div class="text-[9px] text-violet-400 opacity-80 mb-2 truncate">
            {data.summary}
        </div>
    {/if}

    {#if data.tags && data.tags.length > 0}
        <div class="flex flex-wrap gap-1 mt-2 border-t pt-2" style="border-color: {customColor}66">
            {#each data.tags as tag}
                <span
                    class="bg-[#0a0514] px-1 py-0.5 text-[8px] border rounded"
                    style="color: {customColor}; border-color: {customColor}66"
                >
                    @{tag}
                </span>
            {/each}
        </div>
    {/if}

    <Handle
        type="source"
        position={Position.Bottom}
        class="!w-3 !h-3 !border-none !rounded-none"
        style="background-color: {customColor}"
    />
</div>
