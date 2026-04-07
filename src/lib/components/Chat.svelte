<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { onMount, onDestroy, tick } from 'svelte';
    import { slide, fly } from 'svelte/transition';
    import { Paperclip, Send, Brain, Coins, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, AtSign, HelpCircle } from 'lucide-svelte';
    import { runAgentLoop, resolveConfirmation, type AgentLoopParams } from '$lib/agents/agentLoop';
    import { TOOL_MAP, buildToolCatalogSummary } from '$lib/agents/agentTools';
    import { listChats, readChat, writeChat, generateId, type FsChat, type FsChatMessage } from '$lib/agents/fs-db';
    import { chainFromTip, messagesById, childrenByParent, extendTipFromModel, siblingModelsForUser, type BranchMessage } from '$lib/agents/messageBranch';
    import { marked } from 'marked';
    import DOMPurify from 'dompurify';

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
    let commsMode = $state<'plan' | 'ask' | 'agent'>('agent');

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
    let streamingMessageId = $state<string | null>(null);
    let streamingText = $state('');
    let streamingReasoning = $state('');
    
    type ToolCallUI = { name: string; args: any; result?: any; ok?: boolean; callId: string; status: 'running' | 'done' | 'error'; expanded: boolean };
    let streamingToolCalls = $state<ToolCallUI[]>([]);
    
    type SubAgentUI = { glyphId: string; glyphName: string; text: string; done: boolean; expanded: boolean };
    let streamingSubAgents = $state<SubAgentUI[]>([]);

    type PlanStep = { tool: string; args: Record<string, unknown>; rationale: string; checked: boolean };
    let pendingPlan = $state<PlanStep[] | null>(null);
    let isExecutingPlan = $state(false);
    let expandedReasoning = $state<Record<string, boolean>>({});

    let pendingConfirms = $state<{loopId: string, name: string, args: any, reason: string}[]>([]);
    import { open } from '@tauri-apps/plugin-dialog';
    import { readTextFile } from '@tauri-apps/plugin-fs';

    function renderMarkdown(content: string): string {
        if (!content) return '';
        const html = marked.parse(content, { gfm: true, breaks: true }) as string;
        return DOMPurify.sanitize(html);
    }

    function handleChatLinkClick(e: MouseEvent) {
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

    async function runGenerativeStream(parentUserMsgId: string) {
        if (!activeChat || !appState.activeProjectId) return;
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
            glyphId: selectedGlyph
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
                                expanded: true
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

            // Refresh project data so Canvas/Sidebar reflect agent-written changes
            if (streamingToolCalls.length > 0) {
                await appState.reloadProjectData();
            }
            
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

    <div class="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
        {#each messages as msg}
            {@const isUser = msg.role === 'user'}
            {@const childrenMap = activeChat ? childrenByParent(activeChat.messages as BranchMessage[]) : new Map()}
            {@const siblings = msg.parentMessageId ? siblingModelsForUser(msg.parentMessageId, childrenMap) : []}
            {@const siblingIdx = siblings.findIndex(s => s.id === msg.id)}

            <div class="flex flex-col {isUser ? 'items-end' : 'items-start'}" in:fly={{ y: 15, duration: 300 }}>
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-[9px] uppercase tracking-widest text-violet-600">
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
                            <div class="flex items-center gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-violet-400">
                                <span class="{tc.ok ? 'text-emerald-400' : 'text-red-400'}">{tc.ok ? '✓' : '✗'}</span>
                                <span class="text-violet-300">[TOOL]</span>
                                <span class="text-violet-200 truncate flex-1">{tc.name}</span>
                            </div>
                        </div>
                    {/each}
                {/if}
                
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="max-w-[85%] bg-violet-950/20 border border-violet-900/40 p-3 text-violet-200 rounded-lg {isUser ? 'whitespace-pre-wrap' : 'prose prose-invert prose-violet prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-a:text-violet-400 prose-code:text-violet-300'}"
                    onclick={!isUser ? handleChatLinkClick : undefined}
                >
                    {#if isUser}
                        {msg.content || "..."}
                    {:else}
                        {@html renderMarkdown(msg.content || "...")}
                    {/if}
                </div>
            </div>
        {/each}

        {#if streamingMessageId}
            <div class="flex flex-col items-start" in:fly={{ y: 15, duration: 300 }}>
                <div class="flex items-center gap-2 mb-1 w-full">
                    <span class="text-[9px] uppercase tracking-widest text-violet-600">SCULPTOR</span>
                    {#if streamingSubAgents.length > 0}
                        {@const activeSubs = streamingSubAgents.filter(s => !s.done).length}
                        <div class="text-[9px] uppercase tracking-widest text-violet-400 opacity-80 flex items-center gap-1 ml-auto">
                            <Brain size={10} />
                            {activeSubs} ACTIVE CHISEL{activeSubs !== 1 ? 'S' : ''}
                        </div>
                    {/if}
                </div>
                
                {#each streamingToolCalls as tc}
                    <div class="max-w-[85%] w-full mb-2 bg-violet-950/30 border border-violet-700/40 font-mono rounded-lg overflow-hidden">
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

                {#each streamingSubAgents as sub}
                    <div class="max-w-[85%] w-full mb-2 bg-cyan-950/20 border border-cyan-700/30 font-mono rounded-lg overflow-hidden">
                        <button 
                            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-cyan-400 hover:bg-cyan-950/40 transition-colors"
                            onclick={() => sub.expanded = !sub.expanded}
                        >
                            <span class="{!sub.done ? 'text-cyan-500 animate-pulse' : 'text-emerald-400'}">
                                {!sub.done ? '⏳' : '✓'}
                            </span>
                            <span class="text-cyan-300">[CHISEL]</span>
                            <span class="text-cyan-200 truncate flex-1">{sub.glyphName}</span>
                            <span class="text-cyan-700">{sub.expanded ? "▾" : "▸"}</span>
                        </button>
                        {#if sub.expanded}
                            <div class="border-t border-cyan-900/40 px-2 py-1.5 bg-black/40 text-xs text-cyan-300 whitespace-pre-wrap">
                                {sub.text || "..."}
                            </div>
                        {/if}
                    </div>
                {/each}

                {#if !streamingText && streamingToolCalls.length === 0 && streamingSubAgents.length === 0}
                    <div class="max-w-[85%] bg-violet-950/25 border border-violet-700/30 px-4 py-3 text-violet-400 font-mono text-[10px] uppercase tracking-widest rounded-lg flex items-center gap-2">
                        <span class="inline-block w-2 h-2 bg-violet-500 rounded-full animate-ping"></span>
                        [ SCULPTOR THINKING... ]
                    </div>
                {:else if streamingText}
                    <div class="max-w-[85%] bg-violet-950/25 border border-violet-700/30 p-3 text-violet-200 whitespace-pre-wrap rounded-lg">
                        {streamingText}
                    </div>
                {/if}
            </div>
        {/if}

        {#each pendingConfirms as p}
            <div class="flex flex-col items-start mt-2">
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
                <button 
                    class="px-2 py-1 text-[9px] uppercase tracking-widest font-bold rounded transition-colors {commsMode === 'ask' ? 'bg-violet-900/60 text-violet-100' : 'text-violet-500 hover:bg-violet-900/30'}"
                    onclick={() => commsMode = 'ask'}
                >INSPECT</button>
                <button 
                    class="px-2 py-1 text-[9px] uppercase tracking-widest font-bold rounded transition-colors {commsMode === 'plan' ? 'bg-violet-900/60 text-violet-100' : 'text-violet-500 hover:bg-violet-900/30'}"
                    onclick={() => commsMode = 'plan'}
                >BLUEPRINT</button>
                <button 
                    class="px-2 py-1 text-[9px] uppercase tracking-widest font-bold rounded transition-colors {commsMode === 'agent' ? 'bg-violet-900/60 text-violet-100' : 'text-violet-500 hover:bg-violet-900/30'}"
                    onclick={() => commsMode = 'agent'}
                >CARVE</button>
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
                    
                    <div class="flex-1 flex items-center border border-violet-700/40 bg-black px-3 py-2 focus-within:border-violet-500 focus-within:shadow-uv-glow transition-all rounded-lg relative">
                        <span class="text-violet-500 font-bold mr-2">&gt;</span>
                        <textarea 
                            bind:value={input}
                            onkeydown={handleInputKeydown}
                            oninput={handleInputChange}
                            class="flex-1 bg-transparent text-xs text-violet-100 outline-none placeholder:text-violet-800 resize-none h-6 min-h-[24px] max-h-32"
                            placeholder="Awaiting directive... (@ to mention)"
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
                    
                    <button 
                        onclick={send}
                        class="h-10 w-10 flex shrink-0 items-center justify-center border border-violet-500 bg-violet-900/40 text-violet-100 hover:bg-violet-600 hover:shadow-uv-glow transition-all rounded-lg" 
                        title="Send Transmission"
                    >
                        <Send size={14} class="ml-0.5" />
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>
