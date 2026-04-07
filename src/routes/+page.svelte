<script lang="ts">
    import { onMount } from 'svelte';
    import { appState } from '$lib/state.svelte';
    import Sidebar from '$lib/components/Sidebar.svelte';
    import Editor from '$lib/components/Editor.svelte';
    import Chat from '$lib/components/Chat.svelte';
    import Canvas from '$lib/components/Canvas.svelte';
    import TopBar from '$lib/components/TopBar.svelte';
    import Glyphs from '$lib/components/Glyphs.svelte';
    import ProjectSettings from '$lib/components/ProjectSettings.svelte';
    import CommandPalette from '$lib/components/CommandPalette.svelte';
    import DocsModal from '$lib/components/DocsModal.svelte';
    import { fade } from 'svelte/transition';

    onMount(() => {
        appState.reloadProjects();
    });

    $effect(() => {
        if (appState.activeProjectId) {
            appState.reloadProjectData();
        }
    });
</script>

<div class="flex flex-col h-screen w-full bg-[#050308] text-violet-300 relative overflow-hidden">
    <TopBar />
    
    <div class="flex flex-1 overflow-hidden relative">
        <!-- Sidebar -->
        <Sidebar />

        <!-- Main Content Area -->
        <div class="flex flex-1 overflow-hidden relative">
            {#key appState.activeItem?.id || appState.activeItem?.type}
                <div class="absolute inset-0 flex" in:fade={{ duration: 150 }}>
                    {#if appState.activeItem?.type === 'network'}
                        <Canvas mode="network" />
                    {:else if appState.activeItem?.type === 'timeline'}
                        <Canvas mode="timeline" />
                    {:else if appState.activeItem?.type === 'glyphs'}
                        <Glyphs />
                    {:else if appState.activeItem?.type === 'project_settings'}
                        <ProjectSettings />
                    {:else if appState.activeItem}
                        <Editor />
                    {:else}
                        <div class="flex h-full w-full items-center justify-center">
                            <div class="text-center font-mono opacity-50">
                                <p class="text-xs uppercase tracking-widest text-violet-500 mb-2">[ SYSTEM_IDLE ]</p>
                                <p class="text-sm text-violet-300">Select an entity from the directory to begin.</p>
                            </div>
                        </div>
                    {/if}
                </div>
            {/key}
        </div>

        <!-- Studio (Chat Panel) -->
        {#if appState.activeItem}
            <Chat />
        {/if}
    </div>
    
    <CommandPalette />
    {#if appState.showDocs}
        <DocsModal onClose={() => appState.showDocs = false} />
    {/if}
</div>
