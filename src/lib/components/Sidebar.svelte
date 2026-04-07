<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { invoke } from '@tauri-apps/api/core';
    import { generateId } from '$lib/agents/fs-db';
    import { ChevronDown, ChevronRight, Folder as FolderIcon, FileText, Database, Clock, Settings, Plus, FolderPlus, Trash2, Bot } from 'lucide-svelte';
    import { onMount, tick } from 'svelte';

    let projectDropdownOpen = $state(false);

    let expandedFolders = $state<Record<string, boolean>>({});
    let dragOverTarget = $state<string | null>(null);

    function toggleFolder(id: string) {
        expandedFolders[id] = !expandedFolders[id];
    }

    async function openFolder() {
        await invoke('open_folder');
        appState.reloadProjects();
    }

    let itemPrompt = $state<{ type: "document" | "wiki" | "timeline", parentId: string | null, isFolder: boolean, title: string } | null>(null);
    let promptValue = $state('');
    let promptInputRef = $state<HTMLInputElement | null>(null);

    $effect(() => {
        if (itemPrompt && promptInputRef) {
            promptInputRef.focus();
        }
    });

    async function submitPrompt() {
        if (!itemPrompt || !promptValue.trim()) return;
        const { type, parentId, isFolder } = itemPrompt;
        const name = promptValue.trim();
        itemPrompt = null;
        promptValue = '';

        try {
            if (isFolder) {
                await invoke('create_folder', { projectId: appState.activeProjectId, parentFolderId: parentId, name, type });
            } else if (type === 'timeline') {
                const tlId = generateId();
                const now = new Date().toISOString();
                await invoke('write_timeline', {
                    projectId: appState.activeProjectId,
                    timeline: { id: tlId, projectId: appState.activeProjectId, title: name, events: [], edges: [], createdAt: now, updatedAt: now }
                });
                appState.navigateTo({ type: 'timeline', id: tlId });
            } else {
                const newId = await invoke('create_file', { projectId: appState.activeProjectId, folderId: parentId, name, type });
                if (newId) appState.navigateTo({ type: type as any, id: newId as string });
            }
            await appState.reloadProjectData();
        } catch (e) {
            console.error("Failed to create", e);
        }
    }

    function cancelPrompt() {
        itemPrompt = null;
        promptValue = '';
    }

    async function createItem(type: "document" | "wiki" | "timeline", parentId: string | null, isFolder: boolean) {
        if (!appState.activeProjectId) return;
        itemPrompt = { type, parentId, isFolder, title: `Enter new ${isFolder ? 'folder' : 'file'} name:` };
    }

    async function deleteItem(id: string, type: "document" | "wiki" | "timeline", isFolder: boolean) {
        if (!appState.activeProjectId) return;
        const { confirm } = await import('@tauri-apps/plugin-dialog');
        const confirmed = await confirm(`Are you sure you want to delete this ${isFolder ? 'folder' : 'file'}?`, { kind: 'warning' });
        if (!confirmed) return;
        
        try {
            if (isFolder) {
                await invoke('delete_folder', { projectId: appState.activeProjectId, id, type });
            } else if (type === 'timeline') {
                await invoke('delete_timeline', { projectId: appState.activeProjectId, id });
            } else {
                await invoke('delete_file', { projectId: appState.activeProjectId, id, type });
            }
            await appState.reloadProjectData();
        } catch (e) {
            console.error("Failed to delete", e);
        }
    }

    async function handleDrop(e: DragEvent, targetType: "document" | "wiki" | "timeline", targetFolderId: string | null) {
        if (!appState.activeProjectId) return;
        try {
            const text = e.dataTransfer?.getData('text/plain');
            if (!text) return;
            const data = JSON.parse(text);
            if (data.type === targetType && data.id) {
                await invoke('move_file', { 
                    projectId: appState.activeProjectId, 
                    id: data.id, 
                    type: data.type, 
                    newFolderId: targetFolderId 
                });
                await appState.reloadProjectData();
            }
        } catch (err) {
            console.error("Drop failed", err);
        }
    }
</script>

{#snippet fileTree(type: "document" | "wiki" | "timeline", parentId: string | null, depth: number)}
    {@const currentFolders = appState.folders.filter(f => f.type === type && (
        (parentId === null && !f.id.includes('/')) ||
        (parentId !== null && f.id.startsWith(parentId + '/') && f.id.split('/').length === parentId.split('/').length + 1)
    )).sort((a, b) => a.name.localeCompare(b.name))}
    
    {@const currentFiles = (type === 'document' ? appState.documents.filter(d => (d.folderId || null) === parentId) :
                           type === 'wiki' ? appState.wikiEntries.filter(w => (w.folderId || null) === parentId) :
                           (parentId === null ? appState.timelines : [])).sort((a, b) => ((a as any).title || (a as any).name || '').localeCompare((b as any).title || (b as any).name || ''))}

    <ul class="space-y-0.5" style="padding-left: {depth > 0 ? 12 : 0}px;">
        {#each currentFolders as folder}
            <li 
                class="group/folder"
                ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; dragOverTarget = folder.id; }}
                ondragleave={() => { if (dragOverTarget === folder.id) dragOverTarget = null; }}
                ondrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dragOverTarget = null;
                    handleDrop(e, type, folder.id);
                }}
            >
                <div class="flex items-center w-full px-2 py-1 text-violet-400 hover:text-violet-200 hover:bg-violet-900/20 rounded transition-colors {dragOverTarget === folder.id ? 'bg-violet-800/30 ring-1 ring-violet-500/50' : ''}">
                    <button class="flex items-center gap-1.5 flex-1 text-left truncate" onclick={() => toggleFolder(folder.id)}>
                        {#if expandedFolders[folder.id]}
                            <ChevronDown size={12} class="opacity-70 flex-shrink-0" />
                        {:else}
                            <ChevronRight size={12} class="opacity-70 flex-shrink-0" />
                        {/if}
                        <FolderIcon size={12} class="opacity-70 flex-shrink-0" />
                        <span class="truncate">{folder.name}</span>
                    </button>
                    <div class="opacity-0 group-hover/folder:opacity-100 flex items-center gap-1 transition-opacity">
                        <button onclick={(e) => { e.stopPropagation(); createItem(type, folder.id, false); }} class="hover:text-violet-100" title="New File"><Plus size={10} /></button>
                        <button onclick={(e) => { e.stopPropagation(); createItem(type, folder.id, true); }} class="hover:text-violet-100" title="New Folder"><FolderPlus size={10} /></button>
                        <button onclick={(e) => { e.stopPropagation(); deleteItem(folder.id, type, true); }} class="hover:text-red-400 text-red-500/70" title="Delete Folder"><Trash2 size={10} /></button>
                    </div>
                </div>
                {#if expandedFolders[folder.id]}
                    {@render fileTree(type, folder.id, depth + 1)}
                {/if}
            </li>
        {/each}

        {#if type !== 'timeline'}
            {#each currentFiles as file}
                <li 
                    class="group/file"
                    draggable="true"
                    ondragstart={(e) => {
                        e.dataTransfer!.setData('text/plain', JSON.stringify({ type, id: file.id, title: (file as any).title || (file as any).name }));
                    }}
                >
                    <div class="flex items-center w-full px-2 py-1 hover:bg-violet-900/20 rounded {appState.activeItem?.id === file.id && appState.activeItem?.type === type ? 'text-violet-100 bg-violet-900/30' : 'text-violet-300/80 hover:text-violet-100'}" style="padding-left: 18px;">
                        <button class="flex items-center gap-1.5 flex-1 text-left truncate" onclick={() => appState.navigateTo({ type: type as any, id: file.id })}>
                            {#if type === 'document'}
                                <FileText size={10} class="opacity-50 flex-shrink-0" />
                            {:else}
                                <Database size={10} class="opacity-50 flex-shrink-0" />
                            {/if}
                            <span class="truncate">{(file as any).title || (file as any).name}</span>
                        </button>
                        <div class="opacity-0 group-hover/file:opacity-100 flex items-center transition-opacity">
                            <button onclick={(e) => { e.stopPropagation(); deleteItem(file.id, type, false); }} class="hover:text-red-400 text-red-500/70" title="Delete File"><Trash2 size={10} /></button>
                        </div>
                    </div>
                </li>
            {/each}
        {:else}
            <!-- Timelines are flat for now -->
            {#each currentFiles as file}
                <li class="group/file">
                    <div class="flex items-center w-full px-2 py-1 hover:bg-violet-900/20 rounded {appState.activeItem?.id === file.id && appState.activeItem?.type === 'timeline' ? 'text-violet-100 bg-violet-900/30' : 'text-violet-300/80 hover:text-violet-100'}" style="padding-left: 18px;">
                        <button class="flex items-center gap-1.5 flex-1 text-left truncate" onclick={() => appState.navigateTo({ type: 'timeline', id: file.id })}>
                            <Clock size={10} class="opacity-50 flex-shrink-0" />
                            <span class="truncate">{(file as any).title || (file as any).name}</span>
                        </button>
                        <div class="opacity-0 group-hover/file:opacity-100 flex items-center transition-opacity">
                            <button onclick={(e) => { e.stopPropagation(); deleteItem(file.id, type, false); }} class="hover:text-red-400 text-red-500/70" title="Delete File"><Trash2 size={10} /></button>
                        </div>
                    </div>
                </li>
            {/each}
        {/if}
    </ul>
{/snippet}

<div class="flex w-64 flex-col border-r border-violet-900/60 bg-[#020005] font-mono text-[11px] text-violet-400 relative">
    <!-- Project Header -->
    <div class="p-3 border-b border-violet-900/60 relative">
        <button 
            class="flex items-center justify-between w-full hover:text-violet-200 uppercase tracking-widest font-bold py-1 px-2 rounded hover:bg-violet-900/30 transition-colors"
            onclick={() => projectDropdownOpen = !projectDropdownOpen}
        >
            <span class="truncate">{appState.projects.find(p => p.id === appState.activeProjectId)?.name || 'Select Project'}</span>
            <ChevronDown size={14} class="transition-transform {projectDropdownOpen ? 'rotate-180' : ''}" />
        </button>

        {#if projectDropdownOpen}
            <div class="absolute top-full left-0 w-full bg-[#050308] border border-violet-700/40 z-50 shadow-2xl rounded-lg overflow-hidden">
                <ul class="max-h-64 overflow-y-auto py-1">
                    {#each appState.projects as project}
                        <li>
                            <button 
                                class="w-full text-left px-4 py-2 hover:bg-violet-900/40 {appState.activeProjectId === project.id ? 'text-violet-100 bg-violet-900/20 border-l-2 border-violet-500' : 'border-l-2 border-transparent'}"
                                onclick={() => { appState.activeProjectId = project.id; projectDropdownOpen = false; }}
                            >
                                <span class="truncate block">{project.name}</span>
                            </button>
                        </li>
                    {/each}
                    <li>
                        <button 
                            class="w-full text-left px-4 py-2 text-violet-500 hover:text-violet-300 hover:bg-violet-900/40 border-t border-violet-900/60 mt-1 font-bold"
                            onclick={() => { openFolder(); projectDropdownOpen = false; }}
                        >
                            + OPEN NEW...
                        </button>
                    </li>
                </ul>
            </div>
        {/if}
    </div>

    <!-- Scrollable Tree -->
    {#if appState.activeProjectId}
        <div class="flex-1 overflow-y-auto p-2 space-y-4">
            
            <!-- Project Settings -->
            <div class="space-y-1">
                <button 
                    class="w-full text-left px-2 py-1.5 flex items-center gap-2 text-violet-300 hover:text-violet-100 hover:bg-violet-900/20 rounded uppercase tracking-widest {appState.activeItem?.type === 'project_settings' ? 'bg-violet-900/30 text-violet-100' : ''}"
                    onclick={() => appState.navigateTo({ type: 'project_settings', id: 'settings' })}
                >
                    <Settings size={12} />
                    <span>Project Settings</span>
                </button>
                <button 
                    class="w-full text-left px-2 py-1.5 flex items-center gap-2 text-violet-300 hover:text-violet-100 hover:bg-violet-900/20 rounded uppercase tracking-widest {appState.activeItem?.type === 'glyphs' as any ? 'bg-violet-900/30 text-violet-100' : ''}"
                    onclick={() => appState.navigateTo({ type: 'glyphs' as any, id: 'glyphs' })}
                >
                    <Bot size={12} />
                    <span>Glyphs</span>
                </button>
            </div>

            <!-- Crystals -->
            <div 
                class="mb-4"
                role="region"
                aria-label="Crystals Dropzone"
                ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; }}
                ondrop={(e) => { e.preventDefault(); handleDrop(e, 'document', null); }}
            >
                <div class="px-2 mb-1 text-[9px] uppercase tracking-[0.2em] text-violet-500 font-bold flex items-center justify-between group/header">
                    <div class="flex items-center gap-2">
                        <FileText size={10} />
                        <span>Crystals</span>
                    </div>
                    <div class="opacity-0 group-hover/header:opacity-100 flex items-center gap-1 transition-opacity text-violet-400">
                        <button onclick={() => createItem('document', null, false)} class="hover:text-violet-100" title="New File"><Plus size={10} /></button>
                        <button onclick={() => createItem('document', null, true)} class="hover:text-violet-100" title="New Folder"><FolderPlus size={10} /></button>
                    </div>
                </div>
                {@render fileTree("document", null, 0)}
            </div>

            <!-- Artifacts -->
            <div 
                class="mb-4"
                role="region"
                aria-label="Artifacts Dropzone"
                ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; }}
                ondrop={(e) => { e.preventDefault(); handleDrop(e, 'wiki', null); }}
            >
                <div class="px-2 mb-1 text-[9px] uppercase tracking-[0.2em] text-violet-500 font-bold flex items-center justify-between group/header">
                    <div class="flex items-center gap-2">
                        <Database size={10} />
                        <span>Artifacts</span>
                    </div>
                    <div class="opacity-0 group-hover/header:opacity-100 flex items-center gap-1 transition-opacity text-violet-400">
                        <button onclick={() => createItem('wiki', null, false)} class="hover:text-violet-100" title="New File"><Plus size={10} /></button>
                        <button onclick={() => createItem('wiki', null, true)} class="hover:text-violet-100" title="New Folder"><FolderPlus size={10} /></button>
                    </div>
                </div>
                {@render fileTree("wiki", null, 0)}
            </div>

            <!-- Veins (Timelines/DAGs) -->
            <div class="mb-4">
                <div class="px-2 mb-1 text-[9px] uppercase tracking-[0.2em] text-violet-500 font-bold flex items-center justify-between group/header">
                    <div class="flex items-center gap-2">
                        <Clock size={10} />
                        <span>Veins</span>
                    </div>
                    <div class="opacity-0 group-hover/header:opacity-100 flex items-center gap-1 transition-opacity text-violet-400">
                        <button onclick={() => createItem('timeline', null, false)} class="hover:text-violet-100" title="New Vein"><Plus size={10} /></button>
                    </div>
                </div>
                {@render fileTree("timeline", null, 0)}
            </div>

        </div>
    {/if}
</div>

{#if itemPrompt}
    <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div class="bg-[#050308] border border-violet-500 shadow-[0_0_40px_rgba(139,92,246,0.3)] w-full max-w-sm flex flex-col p-6 gap-4 font-mono text-[10px] text-violet-300 rounded-lg">
            <div class="font-bold uppercase tracking-widest text-violet-400">
                [ INPUT REQUIRED ]
            </div>
            <div class="text-violet-100/70 uppercase tracking-widest">
                {itemPrompt.title}
            </div>
            <input 
                type="text" 
                bind:this={promptInputRef}
                bind:value={promptValue} 
                class="w-full bg-[#020005] border border-violet-700/40 p-2 text-violet-100 focus:border-violet-500 focus:outline-none transition-colors rounded-md"
                onkeydown={(e) => { if (e.key === 'Enter') submitPrompt(); if (e.key === 'Escape') cancelPrompt(); }}
                autocomplete="off"
            />
            <div class="flex items-center justify-end gap-2 mt-2">
                <button class="px-4 py-2 border border-violet-700/40 text-violet-400 hover:text-violet-200 hover:bg-violet-900/20 uppercase tracking-widest font-bold transition-colors rounded-md" onclick={cancelPrompt}>
                    Cancel
                </button>
                <button class="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white uppercase tracking-widest font-bold transition-colors rounded-md" onclick={submitPrompt}>
                    Confirm
                </button>
            </div>
        </div>
    </div>
{/if}
