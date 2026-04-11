<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { marked } from 'marked';
    import DOMPurify from 'dompurify';

    // Allow #entity: protocol links through DOMPurify
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
        if (data.attrName === 'href' && data.attrValue.startsWith('#entity:')) {
            data.forceKeepAttr = true;
        }
    });

    import { invoke } from '@tauri-apps/api/core';
    import { extractEntityMentions, extractWikilinks } from '$lib/editor/entityExtractor';
    import { TOOL_MAP, type ToolContext } from '$lib/agents/agentTools';
    import { executeInfill } from '$lib/agents/infill';
    import { embedSingleEntry } from '$lib/agents/embeddings';
    import { Lightbulb, Link as LinkIcon, Hash, Type, Eye, PenLine, Bold, Italic, Heading, List, Quote, Minus } from 'lucide-svelte';
    import { tick } from 'svelte';
    import { slide, fade } from 'svelte/transition';
    import PolisherModal from './PolisherModal.svelte';
    
    let content = $state("");
    let title = $state("");
    let previewContent = $state("");
    let isSaving = $state(false);
    
    let activeItemId = $state<string | null>(null);

    // Infill state
    let selection = $state<{ start: number; end: number; text: string } | null>(null);
    let isInfillOpen = $state(false);
    let infillInstruction = $state("");
    let isInfilling = $state(false);
    let textareaRef = $state<HTMLTextAreaElement | null>(null);

    // View mode: 'split' (both panes), 'write' (editor only), 'read' (preview only)
    let viewMode = $state<'split' | 'write' | 'read'>('split');

    // Polisher state
    let isPolisherOpen = $state(false);
    let polisherSelection = $state<{ start: number; end: number; text: string } | null>(null);

    let lastContentVersion = 0;

    $effect(() => {
        const id = appState.activeItem?.id;
        const version = appState.contentVersion;
        // Refresh when selected file changes OR when content was updated externally (agent wrote to it)
        if (id !== activeItemId || version !== lastContentVersion) {
            activeItemId = id || null;
            lastContentVersion = version;

            let itemData = appState.activeItem?.type === 'document'
                ? appState.documents.find(d => d.id === appState.activeItem?.id)
                : appState.activeItem?.type === 'wiki'
                    ? appState.wikiEntries.find(w => w.id === appState.activeItem?.id)
                    : null;

            if (itemData) {
                content = itemData.content || "";
                title = itemData.title || "";
            } else {
                content = "";
                title = "";
            }
        }
    });

    let debounceTimer: ReturnType<typeof setTimeout>;
    $effect(() => {
        const c = content; // track dependency
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            previewContent = c;
        }, 150);
    });

    let saveDebounce: ReturnType<typeof setTimeout>;
    
    function debouncedSave() {
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(handleSave, 400);
    }

    async function handleSave() {
        if (!appState.activeItem || !appState.activeProjectId) return;
        isSaving = true;
        try {
            const itemType = appState.activeItem.type;
            const itemId = appState.activeItem.id;
            
            if (itemType === 'document') {
                await invoke('update_document', { 
                    id: itemId, 
                    title, 
                    content 
                });
                const doc = appState.documents.find(d => d.id === itemId);
                if (doc) {
                    doc.title = title;
                    doc.content = content;
                }
                embedSingleEntry(appState.activeProjectId, itemId, "document", title, content).catch(() => {});
            } else if (itemType === 'wiki') {
                await invoke('update_wiki_entry', { 
                    id: itemId, 
                    title, 
                    content 
                });
                const wiki = appState.wikiEntries.find(w => w.id === itemId);
                if (wiki) {
                    wiki.title = title;
                    wiki.content = content;
                }
                embedSingleEntry(appState.activeProjectId, itemId, "wiki", title, content).catch(() => {});
            }
        } finally {
            isSaving = false;
        }
    }

    function handleSelection() {
        if (!textareaRef) return;
        const start = textareaRef.selectionStart;
        const end = textareaRef.selectionEnd;
        if (start !== end && end > start) {
            selection = {
                start,
                end,
                text: content.substring(start, end)
            };
        } else {
            if (!isInfillOpen) {
                selection = null;
            }
        }
    }

    async function handleInfillSubmit() {
        if (!selection || !appState.activeItem || !appState.activeProjectId) return;
        isInfilling = true;

        try {
            const replacement = await executeInfill({
                projectId: appState.activeProjectId,
                selectedText: selection.text,
                fullContent: content,
                instruction: infillInstruction || "Rewrite",
            });

            content = content.substring(0, selection.start) + replacement + content.substring(selection.end);
            await handleSave();
            
            if (textareaRef) {
                await tick();
                const newPos = selection.start + replacement.length;
                textareaRef.setSelectionRange(newPos, newPos);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to infill text.");
        } finally {
            isInfilling = false;
            isInfillOpen = false;
            selection = null;
            infillInstruction = "";
        }
    }

    function openPolisher() {
        if (selection) {
            polisherSelection = { ...selection };
        } else {
            // Forward-generation from cursor
            const pos = textareaRef?.selectionStart ?? content.length;
            polisherSelection = { start: pos, end: pos, text: "" };
        }
        isPolisherOpen = true;
        isInfillOpen = false;
    }

    async function handlePolisherApply(polishedText: string) {
        if (!polisherSelection || !appState.activeItem || !appState.activeProjectId) return;
        const { start, end } = polisherSelection;
        content = content.substring(0, start) + polishedText + content.substring(end);
        await handleSave();

        if (textareaRef) {
            await tick();
            const newPos = start + polishedText.length;
            textareaRef.setSelectionRange(newPos, newPos);
        }

        isPolisherOpen = false;
        polisherSelection = null;
        selection = null;
    }

    function wrapSelection(before: string, after: string) {
        if (!textareaRef) return;
        const start = textareaRef.selectionStart;
        const end = textareaRef.selectionEnd;
        const sel = content.substring(start, end);
        const wrapped = before + sel + after;
        content = content.substring(0, start) + wrapped + content.substring(end);
        tick().then(() => {
            if (!textareaRef) return;
            textareaRef.selectionStart = start + before.length;
            textareaRef.selectionEnd = start + before.length + sel.length;
            textareaRef.focus();
        });
        debouncedSave();
    }

    function insertLinePrefix(prefix: string) {
        if (!textareaRef) return;
        const start = textareaRef.selectionStart;
        // Find line start
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        content = content.substring(0, lineStart) + prefix + content.substring(lineStart);
        tick().then(() => {
            if (!textareaRef) return;
            textareaRef.selectionStart = textareaRef.selectionEnd = start + prefix.length;
            textareaRef.focus();
        });
        debouncedSave();
    }

    function handleEditorKeydown(e: KeyboardEvent) {
        const mod = e.metaKey || e.ctrlKey;
        // Cmd/Ctrl+Shift+P → Open The Polisher
        if (mod && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            openPolisher();
            return;
        }
        // Cmd+B → Bold
        if (mod && e.key === 'b') {
            e.preventDefault();
            wrapSelection('**', '**');
            return;
        }
        // Cmd+I → Italic
        if (mod && e.key === 'i') {
            e.preventDefault();
            wrapSelection('*', '*');
            return;
        }
        // Cmd+Shift+H → Heading
        if (mod && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
            e.preventDefault();
            insertLinePrefix('## ');
            return;
        }
        // Cmd+Shift+Q → Blockquote
        if (mod && e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
            e.preventDefault();
            insertLinePrefix('> ');
            return;
        }
        // Cmd+K → Link
        if (mod && e.key === 'k') {
            e.preventDefault();
            wrapSelection('[', '](url)');
            return;
        }
    }

    let renderedMarkdown = $derived.by(() => {
        if (!previewContent) return "";
        const deadSet = deadLinkTargets;
        let preprocessed = previewContent
            // Strip YAML frontmatter
            .replace(/^---\n[\s\S]*?\n---\n/, '')
            // [[Title|display text]] → [display text](#entity:Title)
            .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, target, display) => `[${display.trim()}](#entity:${encodeURIComponent(target.trim())})`)
            // [[Title]] → [Title](#entity:Title)
            .replace(/\[\[([^\]]+)\]\]/g, (_m, title) => `[${title}](#entity:${encodeURIComponent(title)})`)
            // Bare [Title] (not images, not checkboxes, no link after) → entity link
            .replace(/(?<!!)\[([^\]]{2,})\](?!\()/g, (_m, inner) => {
                const t = inner.trim();
                if (!t || t.startsWith("!") || /^[x ]$/i.test(t)) return _m;
                return `[${inner}](#entity:${encodeURIComponent(t)})`;
            })
            // Markdown link intercept for entities (e.g. [display](<Target>))
            .replace(/\]\(\s*<([^>]+)>\s*\)/g, (_m, inner) => `](#entity:${encodeURIComponent(inner)})`);

        const renderer = new marked.Renderer();

        // Custom link renderer: adds entity-link class and dead-link class
        renderer.link = function({ href, text }) {
            if (href && href.startsWith('#entity:')) {
                const target = decodeURIComponent(href.slice(8));
                const isDead = deadSet.has(target.toLowerCase());
                const cls = isDead ? 'entity-link dead-link' : 'entity-link';
                return `<a href="${href}" class="${cls}">${text}</a>`;
            }
            return `<a href="${href}">${text}</a>`;
        };
        
        // Custom blockquote for Obsidian callouts
        // marked v15 passes raw text (not rendered HTML) to blockquote renderer
        renderer.blockquote = function({ text }) {
            const trimmed = text.trim();
            // Match callout syntax: [!type] optional title\nbody
            const match = trimmed.match(/^\[!(\w+)\](.*?)(?:\n([\s\S]*))?$/i);
            if (match) {
                const type = match[1].toLowerCase();
                const rawTitle = (match[2] || '').trim();
                const rawBody = (match[3] || '').trim();
                // Render inline markdown in title and body
                const renderedTitle = rawTitle ? marked.parseInline(rawTitle, { gfm: true, renderer }) : '';
                const renderedBody = rawBody ? marked.parseInline(rawBody, { gfm: true, renderer }) : '';

                if (type === 'quote') {
                    return `<div class="callout callout-quote my-6 p-6 border border-violet-700/40 bg-violet-950/30 rounded-2xl text-sm shadow-lg shadow-violet-950/20">
                        <div class="text-3xl text-violet-500/60 leading-none select-none mb-2">\u201C</div>
                        <div class="italic leading-relaxed text-violet-200/90 text-base pl-2">${renderedBody || renderedTitle}</div>
                        ${renderedBody && renderedTitle ? `<div class="mt-3 pl-2 text-[10px] uppercase tracking-widest text-violet-500 font-bold">\u2014 ${renderedTitle}</div>` : ''}
                        <div class="text-3xl text-violet-500/60 leading-none select-none text-right mt-1">\u201D</div>
                    </div>`;
                }

                const titleDisplay = renderedTitle || type.charAt(0).toUpperCase() + type.slice(1);
                return `<div class="callout my-6 p-6 border border-violet-700/40 bg-violet-950/30 rounded-2xl text-sm shadow-lg shadow-violet-950/20 backdrop-blur-sm">
                    <div class="font-bold text-violet-300 mb-3 tracking-widest uppercase text-xs flex items-center gap-2">
                        <span class="inline-block w-2 h-2 rounded-full bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.6)]"></span>
                        ${titleDisplay}
                    </div>
                    <div class="leading-relaxed text-violet-200/80">${renderedBody}</div>
                </div>`;
            }
            // Regular blockquote — render inline markdown
            const rendered = marked.parseInline(trimmed, { gfm: true, renderer });
            return `<blockquote class="border border-violet-800/40 bg-violet-950/20 p-5 my-6 italic text-violet-300/80 rounded-2xl shadow-lg shadow-violet-950/10">${rendered}</blockquote>`;
        };

        // Custom heading styling with Nightingale
        renderer.heading = function({ text, depth }) {
            const sizes: Record<number, string> = {
                1: 'text-4xl mt-10 mb-6 pb-2 border-b border-violet-900/50',
                2: 'text-3xl mt-8 mb-5',
                3: 'text-2xl mt-6 mb-4',
                4: 'text-xl mt-5 mb-3',
                5: 'text-lg mt-4 mb-2',
                6: 'text-base mt-4 mb-2 uppercase tracking-widest text-violet-500'
            };
            const sizeClass = sizes[depth] || sizes[6];
            return `<h${depth} class="font-heading font-normal text-violet-100 ${sizeClass}">${text}</h${depth}>`;
        };

        const html = marked.parse(preprocessed, { gfm: true, renderer }) as string;
        return DOMPurify.sanitize(html, { ADD_ATTR: ['class', 'target', 'rel'] });
    });

    let wordCount = $derived(content.trim() ? content.trim().split(/\s+/).filter(w => w.length > 0).length : 0);
    let deadLinks = $derived(extractWikilinks(content).filter(link => {
        const foundDocs = appState.documents.find(d => d.title.toLowerCase() === link.target.toLowerCase());
        const foundWikis = appState.wikiEntries.find(w => w.title.toLowerCase() === link.target.toLowerCase() || 
            (w.aliases && w.aliases.toLowerCase().includes(link.target.toLowerCase())));
        return !foundDocs && !foundWikis;
    }));

    let deadLinkTargets = $derived(new Set(deadLinks.map(l => l.target.toLowerCase())));

    let suggestions = $derived(
        extractEntityMentions(content, appState.documents, appState.wikiEntries, appState.activeItem?.id)
            .filter((s, i, self) => i === self.findIndex((t) => t.entityId === s.entityId)) // distinct
            .slice(0, 5) // max 5
    );

    function applySuggestion(suggestion: any) {
        const pre = content.substring(0, suggestion.startIndex);
        const post = content.substring(suggestion.endIndex);
        const newText = `[[${suggestion.entityTitle}|${suggestion.matchText}]]`;
        content = pre + newText + post;
        handleSave();
    }

    function handlePreviewClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        const anchor = target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (!href?.startsWith('#entity:')) return;
        e.preventDefault();
        const entityTitle = decodeURIComponent(href.slice(8));
        const doc = appState.documents.find(d => d.title.toLowerCase() === entityTitle.toLowerCase());
        const wiki = appState.wikiEntries.find(w => w.title.toLowerCase() === entityTitle.toLowerCase());
        if (doc) appState.navigateTo({ type: 'document', id: doc.id });
        else if (wiki) appState.navigateTo({ type: 'wiki', id: wiki.id });
    }

    let isResolvingLinks = $state(false);
    let resolveStatus = $state<string | null>(null);
    let resolveProgress = $state<{current: number; total: number} | null>(null);

    let documentLinks = $derived([...new Set([...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim()))]);

    // Breadcrumb folder
    let breadcrumbFolder = $derived.by(() => {
        const item = appState.activeItem?.type === 'document'
            ? appState.documents.find(d => d.id === appState.activeItem?.id)
            : appState.activeItem?.type === 'wiki'
                ? appState.wikiEntries.find(w => w.id === appState.activeItem?.id)
                : null;
        if (!item || !(item as any).folderId) return null;
        return appState.folders.find(f => f.id === (item as any).folderId) || null;
    });

    async function handleResolveLinks() {
        if (!appState.activeProjectId || !appState.activeItem) return;
        const dead = deadLinks.map(l => l.target);
        if (dead.length === 0) return;

        const tool = TOOL_MAP.get('resolve_dead_links');
        if (!tool) { console.error("resolve_dead_links tool not registered"); return; }

        isResolvingLinks = true;
        resolveStatus = `Resolving ${dead.length} link(s)...`;
        resolveProgress = null;

        try {
            const ctx: ToolContext = {
                projectId: appState.activeProjectId,
                documentId: appState.activeItem.type === 'document' ? appState.activeItem.id : undefined,
                wikiId: appState.activeItem.type === 'wiki' ? appState.activeItem.id : undefined,
                onProgress: (data: any) => {
                    resolveStatus = data?.message || 'Working...';
                    if (data?.current != null && data?.total != null) {
                        resolveProgress = { current: data.current, total: data.total };
                    }
                },
            };

            const result = await tool.execute({ document_id: appState.activeItem.id }, ctx);

            if (!result.ok) {
                resolveStatus = `Error: ${result.error}`;
                console.error("resolve_dead_links failed:", result.error);
                setTimeout(() => { resolveStatus = null; }, 4000);
            } else {
                const d = result.data as any;
                resolveStatus = d?.message || `Created ${d?.created?.length ?? 0} artifact(s)`;
                setTimeout(() => { resolveStatus = null; }, 3000);
            }

            await appState.reloadProjectData();
        } catch (e: any) {
            resolveStatus = `Error: ${e?.message || String(e)}`;
            console.error("Resolve links error:", e);
            setTimeout(() => { resolveStatus = null; }, 4000);
        } finally {
            isResolvingLinks = false;
            resolveProgress = null;
        }
    }

</script>

<div class="flex h-full w-full flex-col">
    <!-- Toolbar -->
    <header class="flex shrink-0 flex-col border-b border-violet-900/50 bg-[#020005]/50 text-xs font-mono">
        <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center gap-4">
                <span class="text-violet-500 font-bold uppercase tracking-widest text-[10px]">
                    {appState.activeItem?.type === 'wiki' ? '[ ARTIFACT ]' : '[ CRYSTAL ]'}
                </span>
                <!-- Breadcrumbs -->
                <div class="flex items-center gap-1 text-[10px] text-violet-600">
                    <span class="text-violet-700">{appState.projects.find(p => p.id === appState.activeProjectId)?.name || 'Project'}</span>
                    <span class="text-violet-800">/</span>
                    <span class="text-violet-700">{appState.activeItem?.type === 'wiki' ? 'artifacts' : 'crystals'}</span>
                    {#if breadcrumbFolder}
                        <span class="text-violet-800">/</span>
                        <span class="text-violet-700">{breadcrumbFolder.name}</span>
                    {/if}
                    <span class="text-violet-800">/</span>
                </div>
                <input
                    type="text"
                    bind:value={title}
                    onblur={handleSave}
                    class="bg-transparent text-violet-100 font-heading tracking-wider outline-none min-w-[200px]"
                    placeholder="Untitled..."
                />
                {#if isSaving}
                    <span class="text-[9px] uppercase tracking-widest text-violet-400 animate-pulse">Saving...</span>
                {/if}
            </div>
            <div class="flex gap-2 items-center">
                {#if resolveStatus && !resolveProgress}
                    <span class="text-[9px] text-violet-400 uppercase tracking-widest {isResolvingLinks ? 'animate-pulse' : ''}">
                        {resolveStatus}
                    </span>
                {/if}
                <button
                    onclick={handleResolveLinks}
                    disabled={deadLinks.length === 0 || isResolvingLinks}
                    class="border border-violet-800/80 bg-black px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-violet-400 hover:border-violet-500 hover:text-violet-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 rounded-md"
                >
                    {#if isResolvingLinks}
                        <span class="animate-pulse">Resolving...</span>
                    {:else}
                        [ Resolve Links ({deadLinks.length}) ]
                    {/if}
                </button>
                <div class="flex items-center border border-violet-800/50 rounded-md overflow-hidden ml-1">
                    <button
                        onclick={() => viewMode = 'write'}
                        class="px-2 py-1 text-[9px] uppercase tracking-widest font-bold transition-colors {viewMode === 'write' ? 'bg-violet-900/50 text-violet-200' : 'text-violet-600 hover:text-violet-400'}"
                        title="Editor only"
                    >
                        <PenLine size={11} />
                    </button>
                    <button
                        onclick={() => viewMode = 'split'}
                        class="px-2 py-1 text-[9px] uppercase tracking-widest font-bold border-x border-violet-800/50 transition-colors {viewMode === 'split' ? 'bg-violet-900/50 text-violet-200' : 'text-violet-600 hover:text-violet-400'}"
                        title="Split view"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                    </button>
                    <button
                        onclick={() => viewMode = 'read'}
                        class="px-2 py-1 text-[9px] uppercase tracking-widest font-bold transition-colors {viewMode === 'read' ? 'bg-violet-900/50 text-violet-200' : 'text-violet-600 hover:text-violet-400'}"
                        title="Reader mode"
                    >
                        <Eye size={11} />
                    </button>
                </div>
            </div>
        </div>
        {#if isResolvingLinks && resolveProgress}
            <div class="px-4 pb-2 flex items-center gap-3">
                <div class="flex-1 h-1 bg-violet-950 rounded-full overflow-hidden">
                    <div
                        class="h-full bg-violet-500 transition-all duration-300 rounded-full"
                        style="width: {Math.max(2, (resolveProgress.current / resolveProgress.total) * 100)}%"
                    ></div>
                </div>
                <span class="text-[9px] text-violet-400 font-mono uppercase tracking-widest shrink-0">
                    {resolveStatus} ({resolveProgress.current}/{resolveProgress.total})
                </span>
            </div>
        {/if}
    </header>

    <!-- Formatting Toolbar -->
    {#if viewMode !== 'read'}
        <div class="flex items-center gap-0.5 px-4 py-1 border-b border-violet-900/40 bg-[#030008]">
            <button onclick={() => wrapSelection('**', '**')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="Bold (Cmd+B)">
                <Bold size={14} />
            </button>
            <button onclick={() => wrapSelection('*', '*')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="Italic (Cmd+I)">
                <Italic size={14} />
            </button>
            <div class="w-px h-4 bg-violet-900/50 mx-1"></div>
            <button onclick={() => insertLinePrefix('## ')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="Heading (Cmd+Shift+H)">
                <Heading size={14} />
            </button>
            <button onclick={() => insertLinePrefix('> ')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="Quote (Cmd+Shift+Q)">
                <Quote size={14} />
            </button>
            <button onclick={() => insertLinePrefix('- ')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="List">
                <List size={14} />
            </button>
            <button onclick={() => insertLinePrefix('---\n')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="Horizontal Rule">
                <Minus size={14} />
            </button>
            <div class="w-px h-4 bg-violet-900/50 mx-1"></div>
            <button onclick={() => wrapSelection('[', '](url)')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="Link (Cmd+K)">
                <LinkIcon size={14} />
            </button>
            <button onclick={() => wrapSelection('[[', ']]')} class="p-1.5 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 rounded transition-colors" title="Wiki Link">
                <Hash size={14} />
            </button>
        </div>
    {/if}

    <!-- Editor Split -->
    <div class="flex flex-1 min-h-0">
        {#if viewMode !== 'read'}
            <div class="flex-1 flex flex-col min-w-0 bg-[#050308] relative {viewMode === 'split' ? 'border-r border-violet-900/50' : ''}">
                <textarea
                    bind:this={textareaRef}
                    bind:value={content}
                    oninput={debouncedSave}
                    onmouseup={handleSelection}
                    onkeyup={handleSelection}
                    onkeydown={handleEditorKeydown}
                    class="editor-textarea flex-1 resize-none bg-transparent p-8 {viewMode === 'write' ? 'max-w-3xl mx-auto w-full' : ''} text-lg font-serif leading-[1.9] text-violet-100/90 outline-none placeholder:text-violet-800 focus:shadow-[inset_0_0_20px_rgba(139,92,246,0.05)]"
                    placeholder="Begin writing..."
                    spellcheck="false"
                ></textarea>

                <!-- Floating Action Bar -->
                {#if selection && !isInfilling && !isInfillOpen && !isPolisherOpen}
                    <div class="absolute left-6 right-6 top-4 z-10 flex gap-2 justify-end pointer-events-none" transition:fade={{ duration: 150 }}>
                        <button
                            type="button"
                            onclick={() => isInfillOpen = true}
                            class="pointer-events-auto border border-violet-500/70 bg-violet-950/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-100 hover:border-violet-400 hover:bg-violet-600 transition-colors shadow-[0_0_20px_rgba(139,92,246,0.3)] backdrop-blur-sm rounded-md"
                        >
                            Rewrite / Infill
                        </button>
                        <button
                            type="button"
                            onclick={openPolisher}
                            class="pointer-events-auto border border-cyan-500/70 bg-cyan-950/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-100 hover:border-cyan-400 hover:bg-cyan-700 transition-colors shadow-[0_0_20px_rgba(6,182,212,0.3)] backdrop-blur-sm rounded-md"
                        >
                            Polish
                        </button>
                    </div>
                {/if}

                {#if isInfillOpen && selection}
                    <div class="absolute left-6 right-6 top-4 z-10 flex items-center gap-2 border border-violet-500/50 bg-black/90 p-2 shadow-[0_0_30px_rgba(139,92,246,0.4)] backdrop-blur-md rounded-lg" transition:fade={{ duration: 150 }}>
                        <input
                            type="text"
                            class="min-w-0 flex-1 border border-violet-700/60 bg-black px-3 py-2 text-xs font-mono text-violet-100 outline-none focus:border-violet-400 placeholder:text-violet-800 rounded"
                            placeholder="Instruction (e.g. expand, tighten POV)"
                            bind:value={infillInstruction}
                            onkeydown={(e) => { if (e.key === "Enter") handleInfillSubmit(); }}
                            disabled={isInfilling}
                        />
                        <button
                            type="button"
                            onclick={handleInfillSubmit}
                            disabled={isInfilling}
                            class="shrink-0 border border-violet-500/70 bg-violet-900/80 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-violet-100 hover:bg-violet-600 disabled:opacity-50 transition-colors rounded-md"
                        >
                            {isInfilling ? "Running..." : "Execute"}
                        </button>
                        <button
                            type="button"
                            onclick={() => { isInfillOpen = false; selection = null; }}
                            disabled={isInfilling}
                            class="shrink-0 px-3 py-2 text-violet-600 hover:text-red-400 font-bold transition-colors"
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>
                {/if}
            </div>
        {/if}
        {#if viewMode !== 'write'}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex-1 flex flex-col min-w-0 bg-[#020005] overflow-y-auto" onclick={handlePreviewClick}>
                <div class="preview-pane {viewMode === 'read' ? 'max-w-2xl mx-auto px-12 py-10' : 'p-8'} prose prose-invert prose-violet prose-lg max-w-none font-serif leading-[1.9] text-violet-200/90 prose-headings:font-heading prose-headings:text-violet-100 prose-a:no-underline">
                    {@html renderedMarkdown}
                </div>
            </div>
        {/if}
    </div>

    <!-- Editor Bottom Bar (spans full width) -->
    <div class="h-8 shrink-0 bg-[#020005] border-t border-violet-900/50 flex items-center justify-between px-4 text-[10px] font-mono text-violet-500 uppercase tracking-widest">
        <div class="flex items-center gap-4 shrink-0">
            <div class="flex items-center gap-1.5" title="Word Count">
                <Type size={12} class="opacity-50" />
                <span>{wordCount}</span>
            </div>
            <div class="flex items-center gap-1.5" title="Character Count">
                <Hash size={12} class="opacity-50" />
                <span>{content.length}</span>
            </div>
        </div>

        {#if suggestions.length > 0}
            <div class="flex items-center gap-2 min-w-0 flex-1 justify-center border-x border-violet-900/50 px-4 mx-4">
                <Lightbulb size={12} class="opacity-50 shrink-0" />
                <div class="flex gap-2 overflow-x-auto no-scrollbar mask-gradient-right pb-1">
                    {#each suggestions as s}
                        <button
                            class="text-violet-400 hover:text-violet-200 whitespace-nowrap bg-violet-950/30 px-1.5 py-0.5 border border-violet-900/40 transition-colors shrink-0 rounded"
                            onclick={() => applySuggestion(s)}
                            title={`Link to ${s.entityTitle}`}
                        >
                            +{s.matchText}
                        </button>
                    {/each}
                </div>
            </div>
        {/if}
        
        <div class="flex items-center gap-2 min-w-0 flex-1 justify-end">
            <LinkIcon size={12} class="opacity-50 shrink-0" />
            {#if documentLinks.length > 0}
                <div class="flex gap-2 overflow-x-auto no-scrollbar mask-gradient-right pb-1">
                    {#each documentLinks as link}
                        <button 
                            class="text-violet-300 hover:text-violet-100 whitespace-nowrap transition-colors shrink-0 border border-transparent hover:border-violet-800/50 px-1 rounded"
                            onclick={() => {
                                // Find if it's a doc or wiki
                                const doc = appState.documents.find(d => d.title === link);
                                const wiki = appState.wikiEntries.find(w => w.title === link);
                                if (doc) appState.navigateTo({ type: 'document', id: doc.id });
                                else if (wiki) appState.navigateTo({ type: 'wiki', id: wiki.id });
                            }}
                        >
                            {link}
                        </button>
                    {/each}
                </div>
            {:else}
                <span class="opacity-30">NONE</span>
            {/if}
        </div>
    </div>
</div>

{#if isPolisherOpen && appState.activeProjectId}
    <PolisherModal
        projectId={appState.activeProjectId}
        selectedText={polisherSelection?.text || ""}
        fullContent={content}
        cursorPos={polisherSelection?.end ?? 0}
        onApply={handlePolisherApply}
        onClose={() => { isPolisherOpen = false; polisherSelection = null; }}
    />
{/if}

<style>
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
    .mask-gradient-right {
        -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
        mask-image: linear-gradient(to right, black 80%, transparent 100%);
    }

    /* Entity link chips */
    .preview-pane :global(a.entity-link) {
        display: inline;
        color: rgb(196 181 253);
        font-weight: 600;
        background: rgba(139, 92, 246, 0.12);
        border: 1px solid rgba(139, 92, 246, 0.35);
        padding: 1px 7px;
        border-radius: 6px;
        text-decoration: none;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
        cursor: pointer;
    }
    .preview-pane :global(a.entity-link:hover) {
        background: rgba(139, 92, 246, 0.25);
        border-color: rgba(139, 92, 246, 0.6);
        color: rgb(237 233 254);
    }
    /* Dead / unresolved links: dashed border + muted */
    .preview-pane :global(a.dead-link) {
        border-style: dashed;
        border-color: rgba(239, 68, 68, 0.45);
        color: rgb(252 165 165);
        background: rgba(239, 68, 68, 0.08);
    }
    .preview-pane :global(a.dead-link:hover) {
        border-color: rgba(239, 68, 68, 0.7);
        background: rgba(239, 68, 68, 0.15);
        color: rgb(254 202 202);
    }
    /* Regular (non-entity) links */
    .preview-pane :global(a:not(.entity-link)) {
        color: rgb(167 139 250);
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    /* Block cursor for editor textarea */
    .editor-textarea {
        caret-shape: block;
        caret-color: rgb(167 139 250);
        font-variation-settings: "SOFT" 100, "WONK" 1;
    }

    /* Fraunces SOFT axis for preview prose */
    .preview-pane {
        font-variation-settings: "SOFT" 100, "WONK" 1;
    }

    /* Reading mode: generous paragraph spacing and breathing room */
    .preview-pane :global(p) {
        margin-top: 1.1em;
        margin-bottom: 1.1em;
    }
    .preview-pane :global(p + p) {
        margin-top: 1.4em;
    }
    .preview-pane :global(br) {
        display: block;
        content: "";
        margin-top: 0.6em;
    }
    .preview-pane :global(h1),
    .preview-pane :global(h2),
    .preview-pane :global(h3) {
        margin-top: 2em;
        margin-bottom: 0.8em;
    }
    .preview-pane :global(blockquote) {
        margin-top: 1.5em;
        margin-bottom: 1.5em;
    }
    .preview-pane :global(hr) {
        margin-top: 2.5em;
        margin-bottom: 2.5em;
    }
</style>
