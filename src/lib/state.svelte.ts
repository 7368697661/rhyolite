import { invoke } from '@tauri-apps/api/core';

export type Project = {
    id: string;
    name: string;
    storyOutline: string;
    loreBible: string;
    updatedAt?: string;
};

export type Folder = { id: string; name: string; type: "document" | "wiki" | "timeline"; projectId: string; };
export type Document = { id: string; title: string; content: string; projectId: string; folderId?: string | null; };
export type WikiEntry = { id: string; title: string; content: string; aliases: string; projectId: string; folderId?: string | null; };
export type TimelineEvent = { id: string; title: string; description: string; date: string; content?: string; summary?: string; nodeType?: string; tags?: string[]; passFullContent?: boolean; referenceId?: string; referenceType?: string; positionX: number; positionY: number; color?: string | null; };
export type TimelineEdge = { id: string; source: string; target: string; label: string; };
export type Timeline = { id: string; title: string; projectId: string; events: TimelineEvent[]; edges: TimelineEdge[]; createdAt?: string; updatedAt?: string; };

export type ActiveItem = {
    type: "document" | "wiki" | "timeline" | "project_settings" | "network" | "glyphs";
    id: string;
};

export type Glyph = {
    id: string;
    name: string;
    provider?: string;
    model: string;
    temperature: number;
    outputLength: number;
    maxOutputTokens?: number;
    isSculpter: boolean;
    role: string;
    systemInstruction?: string;
    specialistRole?: string;
};

export class AppState {
    projects = $state<Project[]>([]);
    activeProjectId = $state<string | null>(null);

    documents = $state<Document[]>([]);
    wikiEntries = $state<WikiEntry[]>([]);
    timelines = $state<Timeline[]>([]);
    folders = $state<Folder[]>([]);
    glyphs = $state<Glyph[]>([]);

    activeTimelineEventId = $state<string | null>(null);
    editorCursorPos = $state<number>(0);

    // Navigation History
    history = $state<ActiveItem[]>([]);
    historyIndex = $state<number>(-1);

    showDocs = $state(false);

    get activeItem() {
        return this.history[this.historyIndex] ?? null;
    }

    async reloadProjects() {
        try {
            console.log('Fetching projects from Tauri backend...');
            const data: Project[] = await invoke('list_projects');
            console.log('Received projects:', data);
            
            this.projects = (data || []).map(p => ({
                ...p,
                loreBible: p.loreBible ?? "",
                storyOutline: p.storyOutline ?? ""
            }));
            
            if (this.projects.length > 0 && !this.activeProjectId) {
                console.log('Setting active project to:', this.projects[0].id);
                this.activeProjectId = this.projects[0].id;
            }

            // Load workspace glyphs
            this.glyphs = await invoke<Glyph[]>('list_glyphs').catch(e => { console.error('list_glyphs failed', e); return []; }) || [];
            
        } catch (err) {
            console.error('Failed to load projects:', err);
            this.projects = [];
        }
    }

    async reloadProjectData() {
        if (!this.activeProjectId) return;
        try {
            console.log('Fetching project data for:', this.activeProjectId);
            const [docs, wikis, times, flds] = await Promise.all([
                invoke<Document[]>('list_documents', { projectId: this.activeProjectId }).catch(e => { console.error('list_documents failed', e); return []; }),
                invoke<WikiEntry[]>('list_wiki_entries', { projectId: this.activeProjectId }).catch(e => { console.error('list_wiki_entries failed', e); return []; }),
                invoke<Timeline[]>('list_timelines', { projectId: this.activeProjectId }).catch(e => { console.error('list_timelines failed', e); return []; }),
                invoke<Folder[]>('list_folders', { projectId: this.activeProjectId }).catch(e => { console.error('list_folders failed', e); return []; })
            ]);
            
            console.log(`Received data: ${docs?.length || 0} docs, ${wikis?.length || 0} wikis`);
            this.documents = docs || [];
            this.wikiEntries = wikis || [];
            this.timelines = times || [];
            this.folders = flds || [];
        } catch (err) {
            console.error('Failed to load project data:', err);
            this.documents = [];
            this.wikiEntries = [];
            this.timelines = [];
            this.folders = [];
        }
    }

    navigateTo(item: ActiveItem) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(item);
        this.historyIndex++;
    }

    goBack() {
        if (this.historyIndex > 0) this.historyIndex--;
    }

    goForward() {
        if (this.historyIndex < this.history.length - 1) this.historyIndex++;
    }
}

export const appState = new AppState();
