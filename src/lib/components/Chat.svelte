<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { onMount, onDestroy, tick } from 'svelte';
    import { slide, fly, fade, scale } from 'svelte/transition';
    import { Paperclip, Send, Square, Brain, Coins, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, AtSign, HelpCircle, Trash2 } from 'lucide-svelte';
    import { runAgentLoop, resolveConfirmation, type AgentLoopParams } from '$lib/agents/agentLoop';
    import { TOOL_MAP, buildToolCatalogSummary } from '$lib/agents/agentTools';
    import { listChats, readChat, writeChat, generateId, type FsChat, type FsChatMessage } from '$lib/agents/fs-db';
    import { chainFromTip, messagesById, childrenByParent, extendTipFromModel, siblingModelsForUser, type BranchMessage } from '$lib/agents/messageBranch';
    import { marked } from 'marked';
    import DOMPurify from 'dompurify';

    // Configure DOMPurify to allow our custom `#entity:` protocol for links
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
        if (data.attrName === 'href' && data.attrValue.startsWith('#entity:')) {
            data.forceKeepAttr = true;
        }
    });

    let input = $state('');
    
    // Core chat state
    let activeChat = $state<FsChat | null>(null);
    let branchChoices = $state<Record<string, string>>({});
    
    // UI state derived from branch
    let messages = $derived.by(() => {
        if (!activeChat || activeChat.messages.length === 0) return [];
        let tipId = activeChat.activeTipMessageId;
        if (!tipId) {
            tipId = activeChat.messages[activeChat.messages.length - 1].id;
        }
        
        const byId = messagesById(activeChat.messages as BranchMessage[]);
        const children = childrenByParent(activeChat.messages as BranchMessage[]);
        const actualTip = extendTipFromModel(tipId, children, branchChoices);
        
        return chainFromTip(actualTip, byId) as FsChatMessage[];
    });

    let currentTipId = $derived(messages.length > 0 ? messages[messages.length - 1].id : null);
    
    // For dead link progress tracking
    let resolveProgress = $state<{message: string, current?: number, total?: number} | null>(null);

    // New Chat Options
    let reasoningMode = $state(false);
    let selectedGlyph = $state<string>('');
    let commsMode = $state<'plan' | 'ask' | 'agent' | 'research' | 'write'>('agent');

    // Live context stats (populated after assembleContext runs each turn)
    type ContextStats = { wikiChars: number; dagChars: number; draftChars: number; systemChars: number; historyChars: number; ragChars: number };
    let contextStats = $state<ContextStats | null>(null);
    let showCtxTooltip = $state(false);

    function estimateTokens(chars: number): number { return Math.round(chars / 4); }
    let totalCtxTokens = $derived(contextStats ? estimateTokens(contextStats.historyChars + contextStats.ragChars + contextStats.systemChars) : 0);

    // @ mention autocomplete
    let mentionQuery = $state('');
    let mentionActive = $state(false);
    let mentionIdx = $state(0);
    let pinnedMentions = $state<{id: string; title: string; type: 'document' | 'wiki'}[]>([]);
    let mentionResults = $derived.by(() => {
        if (!mentionActive || !mentionQuery) return [];
        const q = mentionQuery.toLowerCase();
        const docs = appState.documents.filter(d => d.title.toLowerCase().includes(q)).map(d => ({ id: d.id, title: d.title, type: 'document' as const }));
        const wikis = appState.wikiEntries.filter(w => w.title.toLowerCase().includes(q)).map(w => ({ id: w.id, title: w.title, type: 'wiki' as const }));
        return [...docs, ...wikis].slice(0, 8);
    });

    let isRunning = $state(false);
    let abortController: AbortController | null = null;
    let streamingMessageId = $state<string | null>(null);
    let streamingText = $state('');
    let streamingReasoning = $state('');

    // Auto-scroll: follow bottom while generating, but respect user scroll-up
    let chatContainerRef = $state<HTMLDivElement | null>(null);
    let userScrolledUp = $state(false);

    function handleChatScroll() {
        if (!chatContainerRef) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef;
        // Consider "at bottom" if within 40px of the bottom
        userScrolledUp = scrollHeight - scrollTop - clientHeight > 40;
    }

    $effect(() => {
        // Re-run whenever streaming content changes
        streamingText;
        streamingToolCalls;
        streamingSubAgents;
        if (chatContainerRef && !userScrolledUp && isRunning) {
            tick().then(() => {
                if (chatContainerRef && !userScrolledUp) {
                    chatContainerRef.scrollTop = chatContainerRef.scrollHeight;
                }
            });
        }
    });

    // Also scroll to bottom when a new message arrives (user sends)
    $effect(() => {
        messages.length;
        if (chatContainerRef) {
            userScrolledUp = false;
            tick().then(() => {
                if (chatContainerRef) {
                    chatContainerRef.scrollTop = chatContainerRef.scrollHeight;
                }
            });
        }
    });

    type ToolCallUI = { name: string; args: any; result?: any; ok?: boolean; callId: string; status: 'running' | 'done' | 'error'; expanded: boolean };
    let streamingToolCalls = $state<ToolCallUI[]>([]);
    
    type SubAgentUI = { glyphId: string; glyphName: string; text: string; done: boolean; expanded: boolean; step?: number; totalSteps?: number };
    let streamingSubAgents = $state<SubAgentUI[]>([]);

    type PlanStep = { tool: string; args: Record<string, unknown>; rationale: string; checked: boolean };
    let pendingPlan = $state<PlanStep[] | null>(null);
    let isExecutingPlan = $state(false);
    let expandedReasoning = $state<Record<string, boolean>>({});

    let pendingConfirms = $state<{loopId: string, name: string, args: any, reason: string}[]>([]);
    let inputRef = $state<HTMLTextAreaElement | null>(null);
    import { open } from '@tauri-apps/plugin-dialog';
    import { readTextFile } from '@tauri-apps/plugin-fs';

    function renderMarkdown(content: string): string {
        if (!content) return '';

        // Preprocess wikilinks into markdown links (matching Editor approach)
        let preprocessed = content
            .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, target, display) => `[${display.trim()}](#entity:${encodeURIComponent(target.trim())})`)
            .replace(/\[\[([^\]]+)\]\]/g, (_m, title) => `[${title}](#entity:${encodeURIComponent(title)})`);

        const renderer = new marked.Renderer();

        // Custom link renderer: entity links get pill styling, regular links get underline
        renderer.link = function({ href, text }) {
            if (href && href.startsWith('#entity:')) {
                return `<a href="${href}" class="entity-link">${text}</a>`;
            }
            return `<a href="${href}" class="chat-link" target="_blank" rel="noopener noreferrer">${text}</a>`;
        };

        // Custom blockquote for Obsidian callouts (matching Editor)
        // marked v15 passes raw text (not rendered HTML) to blockquote renderer
        renderer.blockquote = function({ text }) {
            const trimmed = text.trim();
            const match = trimmed.match(/^\[!(\w+)\](.*?)(?:\n([\s\S]*))?$/i);
            if (match) {
                const type = match[1].toLowerCase();
                const rawTitle = (match[2] || '').trim();
                const rawBody = (match[3] || '').trim();
                const renderedTitle = rawTitle ? marked.parseInline(rawTitle, { gfm: true, renderer }) : '';
                const renderedBody = rawBody ? marked.parseInline(rawBody, { gfm: true, renderer }) : '';

                if (type === 'quote') {
                    return `<div class="callout callout-quote my-4 p-4 border border-violet-700/40 bg-violet-950/30 rounded-xl text-sm">
                        <div class="text-xl text-violet-500/60 leading-none select-none mb-1">\u201C</div>
                        <div class="italic leading-relaxed text-violet-200/90 pl-2">${renderedBody || renderedTitle}</div>
                        ${renderedBody && renderedTitle ? `<div class="mt-2 pl-2 text-[10px] uppercase tracking-widest text-violet-500 font-bold">\u2014 ${renderedTitle}</div>` : ''}
                    </div>`;
                }

                const titleDisplay = renderedTitle || type.charAt(0).toUpperCase() + type.slice(1);
                return `<div class="callout my-4 p-4 border border-violet-700/40 bg-violet-950/30 rounded-xl text-sm">
                    <div class="font-bold text-violet-300 mb-2 tracking-widest uppercase text-[10px] flex items-center gap-2">
                        <span class="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.6)]"></span>
                        ${titleDisplay}
                    </div>
                    <div class="leading-relaxed text-violet-200/80">${renderedBody}</div>
                </div>`;
            }
            const rendered = marked.parseInline(trimmed, { gfm: true, renderer });
            return `<blockquote class="border-l-2 border-violet-700/50 pl-3 my-3 text-violet-300/80 italic">${rendered}</blockquote>`;
        };

        const html = marked.parse(preprocessed, { gfm: true, breaks: true, renderer }) as string;
        return DOMPurify.sanitize(html, { ADD_ATTR: ['class', 'target', 'rel'] });
    }

    type EmbeddedBlock = { type: 'crystal' | 'artifact' | 'attachment'; title: string; content: string };

    function parseUserMessage(raw: string): { text: string; blocks: EmbeddedBlock[] } {
        const blocks: EmbeddedBlock[] = [];
        // Match [PINNED CRYSTAL: ...], [PINNED ARTIFACT: ...], [ATTACHMENT: ...]
        const pattern = /\n\n\[(?:PINNED (CRYSTAL|ARTIFACT)|ATTACHMENT): ([^\]]+)\]\n([\s\S]*?)(?=\n\n\[(?:PINNED |ATTACHMENT:)|$)/g;
        let text = raw;
        let match;
        while ((match = pattern.exec(raw)) !== null) {
            const kind = match[1];
            const title = match[2].trim();
            const content = match[3].trim();
            blocks.push({
                type: kind === 'CRYSTAL' ? 'crystal' : kind === 'ARTIFACT' ? 'artifact' : 'attachment',
                title,
                content
            });
        }
        if (blocks.length > 0) {
            // Strip everything from the first block onwards
            const firstIdx = raw.indexOf('\n\n[PINNED ');
            const attachIdx = raw.indexOf('\n\n[ATTACHMENT: ');
            const cutAt = firstIdx !== -1 && attachIdx !== -1 ? Math.min(firstIdx, attachIdx) : firstIdx !== -1 ? firstIdx : attachIdx;
            if (cutAt !== -1) text = raw.substring(0, cutAt);
        }
        return { text, blocks };
    }

    let expandedBlocks = $state<Record<string, boolean>>({});

    function handleChatLinkClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        const anchor = target.closest('a');
        if (!anchor) return;

        let href = anchor.getAttribute('href');

        // Fallback: recover entity name from text if href was stripped
        if ((!href || href === 'about:blank') && anchor.classList.contains('entity-link')) {
            const spanText = anchor.textContent?.trim();
            if (spanText) {
                href = `#entity:${encodeURIComponent(spanText)}`;
            }
        }

        if (href && href.startsWith('#entity:')) {
            e.preventDefault();
            e.stopPropagation();
            const entityTitle = decodeURIComponent(href.slice(8));
            const doc = appState.documents.find(d => d.title.toLowerCase() === entityTitle.toLowerCase());
            const wiki = appState.wikiEntries.find(w => w.title.toLowerCase() === entityTitle.toLowerCase());
            if (doc) appState.navigateTo({ type: 'document', id: doc.id });
            else if (wiki) appState.navigateTo({ type: 'wiki', id: wiki.id });
        }
    }

    let attachments = $state<{name: string, content: string}[]>([]);

    async function handleAttach() {
        try {
            const selected = await open({
                multiple: true,
            });
            if (!selected) return;
            const paths = Array.isArray(selected) ? selected : [selected];
            
            for (const path of paths) {
                const content = await readTextFile(path);
                const name = path.split(/[\\/]/).pop() || 'Unknown File';
                attachments = [...attachments, { name, content }];
            }
        } catch (e) {
            console.error("Failed to attach file", e);
        }
    }


    $effect(() => {
        if (!selectedGlyph && appState.glyphs.length > 0) {
            const firstSculpter = appState.glyphs.find(g => g.isSculpter);
            if (firstSculpter) selectedGlyph = firstSculpter.id;
        }
    });

    // Load or create chat for active item
    $effect(() => {
        if (appState.activeProjectId && appState.activeItem) {
            loadOrCreateChat(appState.activeProjectId, appState.activeItem.id, appState.activeItem.type as "document" | "timeline");
        } else {
            activeChat = null;
        }
    });

    async function loadOrCreateChat(projectId: string, itemId: string, itemType: "document" | "timeline") {
        const chats = await listChats(projectId);
        let chat = chats.find(c => itemType === "document" ? c.documentId === itemId : c.timelineId === itemId);
        
        if (chat) {
            activeChat = await readChat(projectId, chat.id) || chat;
        } else {
            // Create new chat
            chat = {
                id: generateId(),
                projectId,
                title: itemType === "document" ? "Crystal Assistant" : "Vein Assistant",
                documentId: itemType === "document" ? itemId : undefined,
                timelineId: itemType === "timeline" ? itemId : undefined,
                messages: [],
                updatedAt: new Date().toISOString()
            };
            await writeChat(projectId, chat);
            activeChat = chat;
        }
        
        // Ensure default glyph is assigned if it exists
        if (!activeChat.glyphId && selectedGlyph) {
            activeChat.glyphId = selectedGlyph;
            await writeChat(projectId, activeChat);
        } else if (activeChat.glyphId) {
            selectedGlyph = activeChat.glyphId;
        }
    }

    async function saveChat() {
        if (!activeChat || !appState.activeProjectId) return;
        activeChat.updatedAt = new Date().toISOString();
        await writeChat(appState.activeProjectId, activeChat);
    }

    let editingMsgId = $state<string | null>(null);
    let editingContent = $state('');

    async function handleSaveEdit(msgId: string) {
        if (!activeChat) return;
        const msgIdx = activeChat.messages.findIndex(m => m.id === msgId);
        if (msgIdx === -1) return;
        
        // Fork logic: create a new user message with the new content,
        // using the SAME parent as the edited message.
        const originalMsg = activeChat.messages[msgIdx];
        const newMsgId = generateId();
        const newMsg: FsChatMessage = {
            ...originalMsg,
            id: newMsgId,
            content: editingContent,
            createdAt: new Date().toISOString()
        };
        
        activeChat.messages = [...activeChat.messages, newMsg];
        activeChat.activeTipMessageId = newMsgId;
        editingMsgId = null;
        editingContent = '';
        await saveChat();
        await runGenerativeStream(newMsgId);
    }

    async function handleDeleteMessage(msgId: string) {
        if (!activeChat) return;
        if (!confirm("Are you sure you want to delete this message and all its replies?")) return;
        
        const childrenMap = childrenByParent(activeChat.messages as BranchMessage[]);
        
        // Recursive function to gather all descendant IDs
        function getDescendants(id: string): string[] {
            let descendants: string[] = [];
            const children = childrenMap.get(id) || [];
            for (const child of children) {
                descendants.push(child.id);
                descendants = descendants.concat(getDescendants(child.id));
            }
            return descendants;
        }

        const idsToDelete = [msgId, ...getDescendants(msgId)];
        
        activeChat.messages = activeChat.messages.filter(m => !idsToDelete.includes(m.id));
        
        // Fix tip if deleted
        if (idsToDelete.includes(activeChat.activeTipMessageId || "")) {
            activeChat.activeTipMessageId = activeChat.messages.length > 0 
                ? activeChat.messages[activeChat.messages.length - 1].id 
                : "";
        }

        await saveChat();
    }

    async function copyToClipboard(text: string) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    }

    function switchBranch(userId: string, nextModelId: string) {
        branchChoices = { ...branchChoices, [userId]: nextModelId };
        if (activeChat) {
            activeChat.activeTipMessageId = nextModelId;
            saveChat();
        }
    }

    async function handleRegenerate(userId: string) {
        if (!activeChat || isRunning) return;
        const msgIndex = activeChat.messages.findIndex(m => m.id === userId);
        if (msgIndex === -1) return;

        // Set the active tip to the user message so we branch from it
        activeChat.activeTipMessageId = userId;
        await saveChat();
        
        // trigger stream
        await runGenerativeStream(userId);
    }

    function autoResize(el: HTMLTextAreaElement, maxH = 200) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
    }

    function autoResizeOnMount(el: HTMLTextAreaElement) {
        tick().then(() => autoResize(el, 400));
    }

    function handleInputKeydown(e: KeyboardEvent) {
        if (mentionActive && mentionResults.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); mentionIdx = (mentionIdx + 1) % mentionResults.length; return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = (mentionIdx - 1 + mentionResults.length) % mentionResults.length; return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionResults[mentionIdx]); return; }
            if (e.key === 'Escape') { mentionActive = false; return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    }

    function handleInputChange() {
        const text = input;
        const atIdx = text.lastIndexOf('@');
        if (atIdx !== -1 && (atIdx === 0 || text[atIdx - 1] === ' ' || text[atIdx - 1] === '\n')) {
            const after = text.slice(atIdx + 1);
            if (!after.includes(' ') && !after.includes('\n') && after.length < 40) {
                mentionQuery = after;
                mentionActive = true;
                mentionIdx = 0;
                return;
            }
        }
        mentionActive = false;
    }

    function selectMention(item: {id: string; title: string; type: 'document' | 'wiki'}) {
        const atIdx = input.lastIndexOf('@');
        if (atIdx !== -1) input = input.slice(0, atIdx) + `@${item.title} `;
        if (!pinnedMentions.find(m => m.id === item.id)) {
            pinnedMentions = [...pinnedMentions, item];
        }
        mentionActive = false;
    }

    async function send() {
        if (!input.trim() || isRunning || !activeChat) return;
        let sentText = input;
        input = '';
        if (inputRef) inputRef.style.height = 'auto';
        
        // Inject pinned mention contents
        if (pinnedMentions.length > 0) {
            for (const pm of pinnedMentions) {
                if (pm.type === 'document') {
                    const doc = appState.documents.find(d => d.id === pm.id);
                    if (doc) sentText += `\n\n[PINNED CRYSTAL: ${doc.title}]\n${doc.content || '(empty)'}`;
                } else {
                    const wiki = appState.wikiEntries.find(w => w.id === pm.id);
                    if (wiki) sentText += `\n\n[PINNED ARTIFACT: ${wiki.title}]\n${wiki.content || '(empty)'}`;
                }
            }
            pinnedMentions = [];
        }

        if (attachments.length > 0) {
            sentText += '\n\n' + attachments.map(a => `[ATTACHMENT: ${a.name}]\n${a.content}`).join('\n\n');
            attachments = [];
        }
        
        const parentId = currentTipId;
        const userMsg: FsChatMessage = {
            id: generateId(),
            role: "user",
            content: sentText,
            createdAt: new Date().toISOString(),
            parentMessageId: parentId
        };
        
        activeChat.messages = [...activeChat.messages, userMsg];
        activeChat.activeTipMessageId = userMsg.id;
        await saveChat();
        
        await runGenerativeStream(userMsg.id);
    }

    function stopGeneration() {
        abortController?.abort();
        abortController = null;
    }

    onDestroy(() => { abortController?.abort(); });

    async function runGenerativeStream(parentUserMsgId: string) {
        if (!activeChat || !appState.activeProjectId) return;
        abortController?.abort();
        const ac = new AbortController();
        abortController = ac;
        isRunning = true;
        streamingMessageId = generateId();
        streamingText = '';
        streamingReasoning = '';
        streamingToolCalls = [];
        streamingSubAgents = [];
        pendingConfirms = [];

        // Build the branch up to the user message
        const byId = messagesById(activeChat.messages as BranchMessage[]);
        const chainToRootList = chainFromTip(parentUserMsgId, byId) as FsChatMessage[];
        
        const glyph = appState.glyphs.find(g => g.id === selectedGlyph);
        const params: AgentLoopParams = {
            provider: (glyph?.provider as any) || "gemini",
            model: glyph?.model || "gemini-2.0-flash",
            systemInstruction: glyph?.role || glyph?.systemInstruction || "",
            temperature: glyph?.temperature,
            maxOutputTokens: glyph?.outputLength || glyph?.maxOutputTokens,
            branchMessages: activeChat.messages as BranchMessage[],
            tipId: parentUserMsgId,
            mode: commsMode,
            enableReasoning: reasoningMode,
            cursorPosition: appState.editorCursorPos,
            activeTimelineEventId: appState.activeTimelineEventId ?? undefined,
            toolContext: {
                projectId: appState.activeProjectId,
                documentId: activeChat.documentId,
                timelineId: activeChat.timelineId,
                onProgress: (data: any) => {
                    if (data?.type === 'progress') {
                        resolveProgress = {
                            message: data.message || 'Working...',
                            current: data.current,
                            total: data.total
                        };
                    }
                },
            },
            glyphId: selectedGlyph,
            abortSignal: ac.signal
        };

        let resultText = "";
        let resultReasoning = "";

        try {
            await runAgentLoop(params, (event) => {
                if (event.t === 'c') {
                    streamingText += event.d;
                    resultText += event.d;
                } else if (event.t === 's') {
                    // System status message, we can optionally render this somewhere else or keep it inline
                    streamingText += `\n[SYSTEM]: ${event.d}\n`;
                    resultText += `\n[SYSTEM]: ${event.d}\n`;
                } else if (event.t === 'r') {
                    streamingReasoning += event.d;
                    resultReasoning += event.d;
                } else if (event.t === 'tc') {
                    streamingToolCalls = [...streamingToolCalls, { 
                        name: event.d.name, 
                        args: event.d.args, 
                        callId: event.d.callId || generateId(),
                        status: 'running',
                        expanded: false
                    }];
                } else if (event.t === 'tr') {
                    const idx = streamingToolCalls.findIndex(t => t.callId === event.d.callId);
                    if (idx !== -1) {
                        const updated = [...streamingToolCalls];
                        updated[idx].result = event.d.result;
                        updated[idx].ok = event.d.ok;
                        updated[idx].status = event.d.ok ? 'done' : 'error';
                        streamingToolCalls = updated;
                    } else {
                        // Fallback if 'tc' wasn't seen
                        streamingToolCalls = [...streamingToolCalls, { 
                            name: event.d.name, 
                            args: {}, 
                            result: event.d.result, 
                            ok: event.d.ok, 
                            callId: event.d.callId || generateId(),
                            status: event.d.ok ? 'done' : 'error',
                            expanded: false
                        }];
                    }
                } else if (event.t === 'sub') {
                    const existingIdx = streamingSubAgents.findIndex(s => s.glyphId === event.d.glyphId);
                    if (event.d.phase === 'start') {
                        if (existingIdx === -1) {
                            streamingSubAgents = [...streamingSubAgents, {
                                glyphId: event.d.glyphId,
                                glyphName: event.d.glyphName,
                                text: "",
                                done: false,
                                expanded: false,
                                step: event.d.step,
                                totalSteps: event.d.totalSteps,
                            }];
                        }
                    } else if (event.d.phase === 'delta') {
                        if (existingIdx !== -1) {
                            const updated = [...streamingSubAgents];
                            updated[existingIdx].text += event.d.text || "";
                            streamingSubAgents = updated;
                        }
                    } else if (event.d.phase === 'end') {
                        if (existingIdx !== -1) {
                            const updated = [...streamingSubAgents];
                            updated[existingIdx].text += `\n[${event.d.text}]`;
                            updated[existingIdx].done = true;
                            streamingSubAgents = updated;
                        }
                    }
                } else if (event.t === 'confirm') {
                    pendingConfirms = [...pendingConfirms, {
                        loopId: event.d.loopId,
                        name: event.d.name,
                        args: event.d.args,
                        reason: `Requires confirmation for: ${event.d.name}`
                    }];
                } else if (event.t === 'tp') {
                    const steps = (event.d as any[]).map((s: any) => ({ tool: s.tool, args: s.args || {}, rationale: s.rationale || '', checked: true }));
                    pendingPlan = steps;
                    streamingText += `\n[PLAN PROPOSED: ${steps.length} steps]\n`;
                    resultText += `\n[PLAN PROPOSED: ${steps.length} steps]\n`;
                } else if (event.t === 'ctx') {
                    contextStats = event.d as ContextStats;
                } else if (event.t === 'e') {
                    streamingText += `\n[ERROR]: ${event.d.message}\n`;
                    resultText += `\n[ERROR]: ${event.d.message}\n`;
                }
            });
        } catch(e) {
            streamingText += `\n[SYSTEM ERROR]: ${e}`;
            resultText += `\n[SYSTEM ERROR]: ${e}`;
        } finally {
            isRunning = false;
            abortController = null;
            resolveProgress = null;
            
            const modelMsg: FsChatMessage = {
                id: streamingMessageId,
                role: "model",
                content: resultText,
                reasoningContent: resultReasoning || undefined,
                toolCalls: streamingToolCalls.length > 0 ? streamingToolCalls as any : undefined,
                createdAt: new Date().toISOString(),
                parentMessageId: parentUserMsgId
            };
            
            activeChat.messages = [...activeChat.messages, modelMsg];
            
            // Re-render UI: set branch tip
            branchChoices = { ...branchChoices, [parentUserMsgId]: modelMsg.id };
            activeChat.activeTipMessageId = modelMsg.id;
            await saveChat();

            // Refresh project data so Canvas/Sidebar reflect agent-written changes.
            // Always reload — write-mode pipelines modify documents via inner
            // specialist loops whose tool calls aren't surfaced in streamingToolCalls.
            await appState.reloadProjectData();
            
            streamingMessageId = null;
        }
    }

    function handleConfirm(loopId: string, approved: boolean) {
        resolveConfirmation(loopId, approved);
        pendingConfirms = pendingConfirms.filter(p => p.loopId !== loopId);
    }

    async function executePlan() {
        if (!pendingPlan || !activeChat || !appState.activeProjectId) return;
        isExecutingPlan = true;
        const approved = pendingPlan.filter(s => s.checked);
        const ctx = {
            projectId: appState.activeProjectId,
            documentId: activeChat.documentId || null,
            timelineId: activeChat.timelineId || null,
        };
        let planResult = '';
        for (const step of approved) {
            const tool = TOOL_MAP.get(step.tool);
            if (!tool) {
                planResult += `[SKIP] Unknown tool: ${step.tool}\n`;
                continue;
            }
            streamingToolCalls = [...streamingToolCalls, { name: step.tool, args: step.args, callId: generateId(), status: 'running', expanded: false }];
            try {
                const result = await tool.execute(step.args, ctx);
                const lastTc = streamingToolCalls[streamingToolCalls.length - 1];
                lastTc.result = result;
                lastTc.ok = result?.ok !== false;
                lastTc.status = 'done';
                streamingToolCalls = [...streamingToolCalls];
                planResult += `[OK] ${step.tool}\n`;
            } catch (e) {
                const lastTc = streamingToolCalls[streamingToolCalls.length - 1];
                lastTc.result = String(e);
                lastTc.ok = false;
                lastTc.status = 'error';
                streamingToolCalls = [...streamingToolCalls];
                planResult += `[ERR] ${step.tool}: ${e}\n`;
            }
        }
        pendingPlan = null;
        isExecutingPlan = false;
        await appState.reloadProjectData();
    }
</script>

<div class="w-96 flex flex-col border-l border-violet-900/60 bg-[#020005]">
    <div class="px-4 py-3 border-b border-violet-900/60 bg-black/40 flex items-center justify-between">
        <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-widest text-violet-400">
                [ STUDIO ]
            </span>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="relative flex items-center gap-1.5 text-[9px] text-violet-500 font-mono cursor-default"
            role="status"
            onmouseenter={() => showCtxTooltip = true}
            onmouseleave={() => showCtxTooltip = false}
        >
            <Coins size={10} />
            <span>{totalCtxTokens > 0 ? `~${(totalCtxTokens / 1000).toFixed(1)}k` : '—'}</span>
            {#if showCtxTooltip && contextStats}
                <div class="absolute right-0 top-full mt-1 w-52 bg-[#050308] border border-violet-700/50 rounded-lg p-3 text-[9px] text-violet-300 z-50 shadow-lg">
                    <div class="font-bold uppercase tracking-widest text-violet-400 mb-2">Context Breakdown</div>
                    <div class="space-y-1">
                        <div class="flex justify-between"><span class="text-violet-500">History</span><span>~{estimateTokens(contextStats.historyChars).toLocaleString()} tok</span></div>
                        <div class="flex justify-between"><span class="text-violet-500">Artifacts (RAG)</span><span>~{estimateTokens(contextStats.wikiChars).toLocaleString()} tok</span></div>
                        <div class="flex justify-between"><span class="text-violet-500">Veins (DAG)</span><span>~{estimateTokens(contextStats.dagChars).toLocaleString()} tok</span></div>
                        <div class="flex justify-between"><span class="text-violet-500">Draft</span><span>~{estimateTokens(contextStats.draftChars).toLocaleString()} tok</span></div>
                        <div class="flex justify-between"><span class="text-violet-500">System + Bedrock</span><span>~{estimateTokens(contextStats.systemChars).toLocaleString()} tok</span></div>
                        <div class="border-t border-violet-800/40 mt-1 pt-1 flex justify-between font-bold text-violet-200"><span>Total</span><span>~{totalCtxTokens.toLocaleString()} tok</span></div>
                    </div>
                </div>
            {/if}
        </div>
    </div>
    
    <!-- Progress Bar UI -->
    {#if resolveProgress}
        <div transition:slide class="p-4 bg-violet-950/25 border-b border-violet-700/30">
            <span class="animate-pulse text-[10px] text-violet-400 uppercase tracking-wide">
                {resolveProgress.message || "Working..."}
            </span>
            {#if resolveProgress.total && resolveProgress.total > 0}
                <div class="flex items-center gap-2 mt-2">
                    <div class="h-1 w-full bg-violet-950 rounded-full overflow-hidden flex-1">
                        <div
                            class="h-full bg-violet-500 transition-all duration-300"
                            style="width: {Math.min(100, Math.max(0, ((resolveProgress.current || 0) / resolveProgress.total) * 100))}%"
                        ></div>
                    </div>
                    <span class="text-[9px] text-violet-500 font-mono">
                        {resolveProgress.current || 0}/{resolveProgress.total}
                    </span>
                </div>
            {/if}
        </div>
    {/if}

    <div bind:this={chatContainerRef} onscroll={handleChatScroll} class="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {#if messages.length === 0 && !streamingMessageId}
            <div class="flex flex-col items-center justify-center h-full text-center opacity-60 select-none gap-3 py-12">
                <div class="text-violet-700 text-[10px] uppercase tracking-[0.2em] font-bold">No Messages Yet</div>
                <div class="text-violet-800 text-[9px] max-w-[220px] leading-relaxed">Send a message to start a session with your sculptor. Use @ to mention crystals or artifacts for context.</div>
            </div>
        {/if}
        {#each messages as msg}
            {@const isUser = msg.role === 'user'}
            {@const childrenMap = activeChat ? childrenByParent(activeChat.messages as BranchMessage[]) : new Map()}
            {@const siblings = msg.parentMessageId ? siblingModelsForUser(msg.parentMessageId, childrenMap) : []}
            {@const siblingIdx = siblings.findIndex(s => s.id === msg.id)}

            <div class="flex flex-col {isUser ? 'items-end' : 'items-start'}" in:fly={{ y: 15, duration: 300 }}>
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-[10px] uppercase tracking-widest text-violet-600">
                        {isUser ? 'USER' : 'SCULPTOR'}
                    </span>
                    
                    {#if isUser && !isRunning}
                        <button 
                            class="text-violet-600 hover:text-violet-400"
                            onclick={() => handleRegenerate(msg.id)}
                            title="Regenerate from here"
                        >
                            <RefreshCw size={10} />
                        </button>
                        <button 
                            class="text-violet-600 hover:text-violet-400"
                            onclick={() => { editingMsgId = msg.id; editingContent = msg.content; }}
                            title="Edit message"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                        </button>
                    {/if}
                    
                    {#if !isUser && !isRunning}
                        <button 
                            class="text-violet-600 hover:text-violet-400"
                            onclick={() => copyToClipboard(msg.content)}
                            title="Copy as Markdown"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                    {/if}

                    {#if !isRunning}
                        <button 
                            class="text-red-900/60 hover:text-red-500 transition-colors ml-1"
                            onclick={() => handleDeleteMessage(msg.id)}
                            title="Delete message"
                        >
                            <Trash2 size={10} />
                        </button>
                    {/if}
                    
                    {#if !isUser && siblings.length > 1}
                        <div class="flex items-center gap-1 text-violet-500">
                            <button 
                                class="hover:text-violet-300 disabled:opacity-30"
                                disabled={siblingIdx <= 0}
                                onclick={() => switchBranch(msg.parentMessageId!, siblings[siblingIdx - 1].id)}
                            >
                                <ChevronLeft size={10} />
                            </button>
                            <span class="text-[9px]">{siblingIdx + 1}/{siblings.length}</span>
                            <button 
                                class="hover:text-violet-300 disabled:opacity-30"
                                disabled={siblingIdx >= siblings.length - 1}
                                onclick={() => switchBranch(msg.parentMessageId!, siblings[siblingIdx + 1].id)}
                            >
                                <ChevronRight size={10} />
                            </button>
                        </div>
                    {/if}
                </div>

                {#if !isUser && msg.reasoningContent}
                    <button
                        class="mb-1 text-[9px] text-violet-600 hover:text-violet-400 flex items-center gap-1 transition-colors"
                        onclick={() => expandedReasoning[msg.id] = !expandedReasoning[msg.id]}
                    >
                        <ChevronDown size={10} class="transition-transform {expandedReasoning[msg.id] ? '' : '-rotate-90'}" />
                        Reasoning
                    </button>
                    {#if expandedReasoning[msg.id]}
                        <div class="max-w-[85%] mb-1 p-2 bg-violet-950/10 border border-violet-900/20 text-[10px] text-violet-500 whitespace-pre-wrap rounded-lg">
                            {msg.reasoningContent}
                        </div>
                    {/if}
                {/if}

                {#if !isUser && msg.toolCalls && msg.toolCalls.length > 0}
                    {#each msg.toolCalls as tc}
                        <div class="max-w-[85%] w-full mb-1 bg-violet-950/30 border border-violet-800/60 font-mono rounded-lg overflow-hidden">
                            <button 
                                class="flex w-full items-center gap-2 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-violet-400 hover:bg-violet-950/50 transition-colors"
                                onclick={() => tc.expanded = !tc.expanded}
                            >
                                <span class="{tc.ok ? 'text-emerald-400' : 'text-red-400'}">{tc.ok ? '✓' : '✗'}</span>
                                <span class="text-violet-300">[TOOL]</span>
                                <span class="text-violet-200 truncate flex-1">{tc.name}</span>
                                <span class="text-violet-700">{tc.expanded ? "▾" : "▸"}</span>
                            </button>
                            {#if tc.expanded}
                                <div class="border-t border-violet-800/40 px-2 py-1 flex flex-col gap-1 bg-black/40 text-[9px] text-violet-300">
                                    <div class="text-violet-600 font-bold">Args:</div>
                                    <pre class="whitespace-pre-wrap overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
                                    <div class="text-violet-600 font-bold mt-1">Result:</div>
                                    <pre class="whitespace-pre-wrap max-h-32 overflow-y-auto overflow-x-auto text-violet-400">{JSON.stringify(tc.result, null, 2)}</pre>
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}
                
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="max-w-[85%] bg-violet-950/20 border border-violet-900/40 p-3 text-violet-200 rounded-lg {isUser ? 'whitespace-pre-wrap' : 'prose prose-invert prose-violet max-w-none prose-p:my-1.5 prose-headings:my-3'} w-full"
                    onclick={!isUser ? handleChatLinkClick : undefined}
                >
                    {#if isUser}
                        {#if editingMsgId === msg.id}
                            <div class="flex flex-col gap-2">
                                <textarea
                                    bind:value={editingContent}
                                    use:autoResizeOnMount
                                    oninput={(e) => autoResize(e.currentTarget as HTMLTextAreaElement)}
                                    class="w-full bg-black/50 border border-violet-700/50 rounded p-2 text-violet-100 font-mono text-xs outline-none focus:border-violet-500 resize-none min-h-[80px]"
                                    style="max-height: 400px; overflow-y: auto;"
                                ></textarea>
                                <div class="flex justify-end gap-2">
                                    <button class="text-[9px] uppercase tracking-widest text-violet-400 hover:text-violet-300" onclick={() => editingMsgId = null}>Cancel</button>
                                    <button class="text-[9px] uppercase tracking-widest bg-violet-900/60 hover:bg-violet-600 text-violet-100 px-2 py-1 rounded" onclick={() => handleSaveEdit(msg.id)}>Save & Run</button>
                                </div>
                            </div>
                        {:else}
                            {@const parsed = parseUserMessage(msg.content || "...")}
                            <div class="whitespace-pre-wrap">{parsed.text}</div>
                            {#if parsed.blocks.length > 0}
                                <div class="flex flex-col gap-1.5 mt-2 pt-2 border-t border-violet-800/30">
                                    {#each parsed.blocks as block, bi}
                                        {@const blockKey = `${msg.id}_${bi}`}
                                        <div class="border border-violet-800/40 rounded-lg overflow-hidden bg-black/30">
                                            <button
                                                class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[9px] uppercase tracking-widest hover:bg-violet-950/40 transition-colors"
                                                onclick={() => expandedBlocks[blockKey] = !expandedBlocks[blockKey]}
                                            >
                                                <span class="{block.type === 'crystal' ? 'text-violet-400' : block.type === 'artifact' ? 'text-cyan-400' : 'text-amber-400'}">
                                                    {block.type === 'crystal' ? '◆' : block.type === 'artifact' ? '◇' : '▫'}
                                                </span>
                                                <span class="text-violet-300 font-bold truncate flex-1">{block.title}</span>
                                                <span class="text-violet-700 text-[8px]">{block.type.toUpperCase()}</span>
                                                <span class="text-violet-700">{expandedBlocks[blockKey] ? '▾' : '▸'}</span>
                                            </button>
                                            {#if expandedBlocks[blockKey]}
                                                <div class="border-t border-violet-800/30 px-2.5 py-2 text-[10px] text-violet-400 max-h-48 overflow-y-auto whitespace-pre-wrap">
                                                    {block.content}
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        {/if}
                    {:else}
                        {@html renderMarkdown(msg.content || "...")}
                    {/if}
                </div>
            </div>
        {/each}

        {#if streamingMessageId}
            <div class="flex flex-col items-start" in:fly={{ y: 15, duration: 300 }}>
                <div class="flex items-center gap-2 mb-1 w-full">
                    <span class="text-[10px] uppercase tracking-widest text-violet-600">SCULPTOR</span>
                    {#if streamingSubAgents && streamingSubAgents.length > 0}
                        {@const activeSubs = streamingSubAgents.filter(s => !s.done).length}
                        <div class="text-[9px] uppercase tracking-widest text-violet-400 opacity-80 flex items-center gap-1 ml-auto">
                            <Brain size={10} />
                            {activeSubs} ACTIVE CHISEL{activeSubs !== 1 ? 'S' : ''}
                        </div>
                    {/if}
                </div>
                
                {#if streamingToolCalls && streamingToolCalls.length > 0}
                    {#each streamingToolCalls as tc}
                        <div class="max-w-[85%] w-full mb-2 bg-violet-950/30 border border-violet-700/40 font-mono rounded-lg overflow-hidden" in:slide={{ duration: 200 }}>
                            <button 
                                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-violet-400 hover:bg-violet-950/50 transition-colors"
                                onclick={() => tc.expanded = !tc.expanded}
                            >
                                <span class="{tc.status === 'running' ? 'text-violet-500 animate-pulse' : tc.ok ? 'text-emerald-400' : 'text-red-400'}">
                                    {tc.status === 'running' ? '⏳' : tc.ok ? '✓' : '✗'}
                                </span>
                                <span class="text-violet-300">[TOOL]</span>
                                <span class="text-violet-200 truncate flex-1">{tc.name}</span>
                                <span class="text-violet-700">{tc.expanded ? "▾" : "▸"}</span>
                            </button>
                            {#if tc.expanded}
                                <div class="border-t border-violet-800/40 px-2 py-1.5 bg-black/40 text-[9px] text-violet-300">
                                    <div class="mb-1 text-violet-600 font-bold">Args:</div>
                                    <pre class="whitespace-pre-wrap mb-2 overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
                                    {#if tc.status !== 'running'}
                                        <div class="mb-1 text-violet-600 font-bold">Result:</div>
                                        <pre class="whitespace-pre-wrap max-h-32 overflow-y-auto overflow-x-auto text-violet-400">{JSON.stringify(tc.result, null, 2)}</pre>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}

                {#if streamingSubAgents && streamingSubAgents.length > 0}
                    {@const totalSteps = streamingSubAgents[0]?.totalSteps ?? 0}
                    {@const doneCount = streamingSubAgents.filter(s => s.done).length}
                    {@const activeStep = streamingSubAgents.find(s => !s.done)}
                    {@const allDone = doneCount === streamingSubAgents.length}

                    {#if totalSteps > 0}
                        <div class="max-w-[85%] w-full mb-2" in:fade={{ duration: 200 }}>
                            <div class="flex items-center justify-between mb-1">
                                <span class="text-[10px] uppercase tracking-widest text-cyan-500 font-bold font-mono">
                                    {allDone ? 'Pipeline Complete' : activeStep ? `${activeStep.glyphName}` : 'Pipeline'}
                                </span>
                                <span class="text-[10px] text-cyan-600 font-mono">{doneCount}/{totalSteps}</span>
                            </div>
                            <div class="h-1 bg-cyan-950/60 rounded-full overflow-hidden">
                                <div
                                    class="h-full rounded-full transition-all duration-700 ease-out {allDone ? 'bg-emerald-500/70' : 'bg-cyan-500/60'}"
                                    style="width: {allDone ? 100 : ((doneCount / totalSteps) * 100 + (1 / totalSteps) * 50)}%"
                                ></div>
                            </div>
                        </div>
                    {/if}

                    {#each streamingSubAgents as sub}
                        <div class="max-w-[85%] w-full mb-1.5 bg-cyan-950/20 border border-cyan-700/30 font-mono rounded-lg overflow-hidden" in:slide={{ duration: 200 }}>
                            <button
                                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-cyan-400 hover:bg-cyan-950/40 transition-colors"
                                onclick={() => sub.expanded = !sub.expanded}
                            >
                                <span class="{!sub.done ? 'text-cyan-500 animate-pulse' : 'text-emerald-400'}">
                                    {!sub.done ? '⏳' : '✓'}
                                </span>
                                {#if sub.step && sub.totalSteps}
                                    <span class="text-cyan-600">[{sub.step}/{sub.totalSteps}]</span>
                                {/if}
                                <span class="text-cyan-200 truncate flex-1">{sub.glyphName}</span>
                                <span class="text-cyan-700">{sub.expanded ? "▾" : "▸"}</span>
                            </button>
                            {#if sub.expanded}
                                <div class="teal-scrollbar border-t border-cyan-900/40 px-2 py-1.5 bg-black/40 text-[10px] text-cyan-300/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
                                    {sub.text || "..."}
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}

                {#if !streamingText && streamingToolCalls.length === 0 && streamingSubAgents.length === 0}
                    <div class="max-w-[85%] bg-violet-950/25 border border-violet-700/30 px-4 py-3 text-violet-400 font-mono text-[10px] uppercase tracking-widest rounded-lg flex items-center gap-2" in:fade={{ duration: 300 }}>
                        <span class="inline-block w-2 h-2 bg-violet-500 rounded-full animate-ping"></span>
                        [ SCULPTOR THINKING... ]
                    </div>
                {:else if streamingText}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="max-w-[85%] bg-violet-950/25 border border-violet-700/30 p-3 text-violet-200 rounded-lg prose prose-invert prose-violet prose-sm max-w-none prose-p:my-1 prose-headings:my-2"
                        onclick={handleChatLinkClick}
                    >
                        {@html renderMarkdown(streamingText)}
                    </div>
                {/if}
            </div>
        {/if}

        {#each pendingConfirms as p}
            <div class="flex flex-col items-start mt-2" in:scale={{ start: 0.95, duration: 200 }}>
                <div class="max-w-[85%] bg-yellow-950/20 border border-yellow-900/40 p-3 text-yellow-200 rounded-lg">
                    <p class="font-bold mb-2 uppercase text-[10px]">Action Required: {p.name}</p>
                    <p class="mb-3 opacity-80">{p.reason}</p>
                    <div class="flex gap-2">
                        <button class="px-3 py-1 bg-violet-900/40 hover:bg-violet-600 border border-violet-500 rounded-lg transition-colors" onclick={() => handleConfirm(p.loopId, true)}>Approve</button>
                        <button class="px-3 py-1 bg-red-900/40 hover:bg-red-600 border border-red-500 rounded-lg transition-colors" onclick={() => handleConfirm(p.loopId, false)}>Deny</button>
                    </div>
                </div>
            </div>
        {/each}

        {#if pendingPlan}
            <div class="flex flex-col items-start mt-2">
                <div class="max-w-[90%] bg-violet-950/30 border border-violet-700/50 p-3 rounded-lg">
                    <p class="font-bold mb-2 uppercase text-[10px] text-violet-400 tracking-widest">Blueprint Checklist</p>
                    {#each pendingPlan as step, i}
                        <label class="flex items-start gap-2 mb-2 cursor-pointer text-xs text-violet-200 hover:text-violet-100">
                            <input type="checkbox" bind:checked={step.checked} class="accent-violet-500 mt-0.5" />
                            <div>
                                <span class="font-mono text-violet-300 text-[10px]">{step.tool}</span>
                                {#if step.rationale}
                                    <span class="text-violet-500 ml-1">{step.rationale}</span>
                                {/if}
                            </div>
                        </label>
                    {/each}
                    <div class="flex gap-2 mt-3">
                        <button
                            class="px-3 py-1.5 bg-violet-900/40 hover:bg-violet-600 border border-violet-500 rounded-lg text-[10px] uppercase tracking-widest font-bold text-violet-100 transition-colors disabled:opacity-50"
                            disabled={isExecutingPlan || pendingPlan.filter(s => s.checked).length === 0}
                            onclick={executePlan}
                        >Execute {pendingPlan.filter(s => s.checked).length} Steps</button>
                        <button
                            class="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/60 border border-red-800/50 rounded-lg text-[10px] uppercase tracking-widest font-bold text-red-400 transition-colors"
                            onclick={() => pendingPlan = null}
                        >Dismiss</button>
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <!-- Controls Area -->
    <div class="p-3 border-t border-violet-900/60 bg-black/60 flex flex-col gap-2">
        <div class="flex items-center justify-between px-1">
            <div class="flex items-center gap-1">
                <select
                    bind:value={commsMode}
                    class="bg-[#050308] border border-violet-900/60 text-violet-300 text-[9px] uppercase tracking-widest font-bold font-mono py-1 px-2 outline-none focus:border-violet-500 rounded-md appearance-none cursor-pointer"
                >
                    <option value="ask">INSPECT</option>
                    <option value="plan">BLUEPRINT</option>
                    <option value="agent">CARVE</option>
                    <option value="write">WRITE</option>
                    <option value="research">RESEARCH</option>
                </select>
            </div>
            
            <div class="flex items-center gap-2">
                <select 
                    bind:value={selectedGlyph}
                    onchange={() => { if (activeChat && appState.activeProjectId) { activeChat.glyphId = selectedGlyph; saveChat(); } }}
                    class="bg-[#050308] border border-violet-900/60 text-violet-300 text-[10px] uppercase tracking-widest font-mono py-1 px-1 outline-none focus:border-violet-500 max-w-[120px] rounded-md"
                >
                    {#each appState.glyphs.filter(g => g.isSculpter) as glyph}
                        <option value={glyph.id}>{glyph.name}</option>
                    {/each}
                </select>

                <button 
                    class="flex items-center justify-center w-6 h-6 rounded border transition-colors {reasoningMode ? 'bg-violet-900/60 border-violet-500 text-violet-100 shadow-uv-glow' : 'border-violet-900/60 text-violet-500 hover:border-violet-500/50 hover:text-violet-300'}"
                    onclick={() => reasoningMode = !reasoningMode}
                    title="Toggle Reasoning Mode"
                >
                    <Brain size={12} />
                </button>
            </div>
        </div>

        <div class="flex items-end gap-2">
            <div class="flex flex-col gap-1 w-full relative">
                {#if pinnedMentions.length > 0 || attachments.length > 0}
                    <div class="flex flex-wrap gap-1 px-1 mb-1">
                        {#each pinnedMentions as pm, i}
                            <div class="flex items-center gap-1 bg-cyan-900/40 border border-cyan-700/30 text-cyan-200 text-[9px] px-2 py-0.5 rounded">
                                <AtSign size={8} />
                                <span class="truncate max-w-[100px]">{pm.title}</span>
                                <button class="hover:text-red-400" onclick={() => pinnedMentions = pinnedMentions.filter((_, idx) => idx !== i)}>×</button>
                            </div>
                        {/each}
                        {#each attachments as att, i}
                            <div class="flex items-center gap-1 bg-violet-900/60 text-violet-200 text-[9px] px-2 py-0.5 rounded">
                                <span class="truncate max-w-[100px]">{att.name}</span>
                                <button class="hover:text-red-400" onclick={() => attachments = attachments.filter((_, idx) => idx !== i)}>×</button>
                            </div>
                        {/each}
                    </div>
                {/if}
                <div class="flex items-end gap-2 relative">
                    <button onclick={handleAttach} class="h-10 w-10 flex shrink-0 items-center justify-center border border-violet-900/60 bg-black text-violet-400 hover:border-violet-500 hover:text-violet-200 transition-colors rounded-lg" title="Attach context">
                        <Paperclip size={14} />
                    </button>
                    
                    <div class="flex-1 flex items-start border border-violet-700/40 bg-black px-3 py-2 focus-within:border-violet-500 focus-within:shadow-uv-glow transition-all rounded-lg relative">
                        <span class="text-violet-500 font-bold mr-2 mt-0.5">&gt;</span>
                        <textarea
                            bind:this={inputRef}
                            bind:value={input}
                            onkeydown={handleInputKeydown}
                            oninput={(e) => { handleInputChange(); autoResize(e.currentTarget as HTMLTextAreaElement); }}
                            class="flex-1 bg-transparent text-sm text-violet-100 outline-none placeholder:text-violet-800 resize-none min-h-[24px]"
                            style="max-height: 200px; overflow-y: auto;"
                            placeholder="Message your sculptor... (@ to mention, Shift+Enter for newline)"
                            rows="1"
                        ></textarea>

                        {#if mentionActive && mentionResults.length > 0}
                            <div class="absolute left-0 bottom-full mb-1 w-full bg-[#050308] border border-violet-600/50 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                                {#each mentionResults as item, i}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        class="flex items-center gap-2 px-3 py-2 text-[10px] font-mono cursor-pointer transition-colors {i === mentionIdx ? 'bg-violet-900/40 text-violet-100' : 'text-violet-400 hover:bg-violet-900/20'}"
                                        onclick={() => selectMention(item)}
                                    >
                                        <AtSign size={10} class="text-cyan-500 shrink-0" />
                                        <span class="truncate">{item.title}</span>
                                        <span class="ml-auto text-[8px] uppercase tracking-widest text-violet-600">{item.type === 'document' ? 'Crystal' : 'Artifact'}</span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                    
                    {#if isRunning}
                        <button
                            onclick={stopGeneration}
                            class="h-10 w-10 flex shrink-0 items-center justify-center border border-red-500/60 bg-red-900/30 text-red-300 hover:bg-red-800/50 hover:border-red-400 transition-all rounded-lg"
                            title="Stop Generation"
                        >
                            <Square size={14} />
                        </button>
                    {:else}
                        <button
                            onclick={send}
                            class="h-10 w-10 flex shrink-0 items-center justify-center border border-violet-500 bg-violet-900/40 text-violet-100 hover:bg-violet-600 hover:shadow-uv-glow transition-all rounded-lg"
                            title="Send Transmission"
                        >
                            <Send size={14} class="ml-0.5" />
                        </button>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    /* Entity link pills (matching Editor reader mode) */
    :global(.entity-link) {
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
    :global(.entity-link:hover) {
        background: rgba(139, 92, 246, 0.25);
        border-color: rgba(139, 92, 246, 0.6);
        color: rgb(237 233 254);
    }

    /* Regular links in chat */
    :global(.chat-link) {
        color: rgb(167 139 250);
        text-decoration: underline;
        text-underline-offset: 2px;
        transition: color 0.15s;
    }
    :global(.chat-link:hover) {
        color: rgb(221 214 254);
    }

    /* Ensure links inside callouts render properly */
    :global(.callout a.entity-link) {
        color: rgb(196 181 253);
        font-weight: 600;
        background: rgba(139, 92, 246, 0.12);
        border: 1px solid rgba(139, 92, 246, 0.35);
        padding: 1px 7px;
        border-radius: 6px;
        text-decoration: none;
    }
    :global(.callout a:not(.entity-link)) {
        color: rgb(167 139 250);
        text-decoration: underline;
        text-underline-offset: 2px;
    }
</style>
