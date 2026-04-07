<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { readProject, updateProject, type FsProject } from '$lib/agents/fs-db';
    import { Save } from 'lucide-svelte';

    let project = $state<FsProject | null>(null);
    let saving = $state(false);

    $effect(() => {
        if (appState.activeProjectId) {
            readProject(appState.activeProjectId).then(p => {
                project = p;
            });
        }
    });

    async function handleSave() {
        if (!project) return;
        saving = true;
        try {
            await updateProject(project);
            
            // Re-fetch project list to update names if it changed
            const projId = appState.activeProjectId;
            await appState.reloadProjects();
            appState.activeProjectId = projId; // restore selection
            
            setTimeout(() => {
                saving = false;
            }, 500);
        } catch (e) {
            console.error(e);
            saving = false;
        }
    }
</script>

<div class="flex-1 h-full bg-[#050308] text-violet-100 flex flex-col items-center justify-center font-mono overflow-y-auto p-8">
    <div class="w-full max-w-4xl bg-black border border-violet-700/30 shadow-[0_0_40px_rgba(46,16,101,0.2)] rounded-lg overflow-hidden">
        <div class="p-6 border-b border-violet-900/60 bg-violet-950/20 flex items-center justify-between">
            <h1 class="text-xl font-bold uppercase tracking-widest text-violet-300">Project Settings</h1>
            
            <button 
                onclick={handleSave}
                class="flex items-center gap-2 px-4 py-2 bg-violet-900/40 border border-violet-500 rounded-lg text-xs uppercase tracking-widest hover:bg-violet-600 transition-colors"
            >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save'}
            </button>
        </div>

        {#if project}
            <div class="p-6 space-y-8">
                <div class="space-y-2">
                    <label for="project-name" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">Project Name</label>
                    <input 
                        id="project-name"
                        type="text" 
                        bind:value={project.name}
                        class="w-full bg-[#020005] border border-violet-700/40 p-3 text-sm focus:border-violet-500 outline-none transition-colors rounded-lg"
                    />
                </div>

                <div class="space-y-2">
                    <label for="lore-bible" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">Bedrock (Core Canon)</label>
                    <p class="text-[10px] text-violet-400/60">Injected into EVERY chisel and sculptor prompt. Keep it dense and essential.</p>
                    <textarea 
                        id="lore-bible"
                        bind:value={project.loreBible}
                        rows="8"
                        class="w-full bg-[#020005] border border-violet-700/40 p-3 text-sm focus:border-violet-500 outline-none transition-colors font-mono resize-y rounded-lg"
                        placeholder="World rules, magic systems, character absolute truths..."
                    ></textarea>
                </div>

                <div class="space-y-2">
                    <label for="story-outline" class="block text-[10px] uppercase tracking-widest text-violet-500 font-bold">The Grain (Story Outline)</label>
                    <p class="text-[10px] text-violet-400/60">The high-level narrative structure. Also injected into sculptor context.</p>
                    <textarea 
                        id="story-outline"
                        bind:value={project.storyOutline}
                        rows="8"
                        class="w-full bg-[#020005] border border-violet-700/40 p-3 text-sm focus:border-violet-500 outline-none transition-colors font-mono resize-y rounded-lg"
                        placeholder="Act 1, Act 2, Act 3..."
                    ></textarea>
                </div>
            </div>
        {:else}
            <div class="p-12 text-center text-violet-500/50">Loading settings...</div>
        {/if}
    </div>
</div>
