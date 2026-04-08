<script lang="ts">
    import { X } from 'lucide-svelte';
    import { marked } from 'marked';
    import DOMPurify from 'dompurify';
    import { fade, scale } from 'svelte/transition';
    import { backOut } from 'svelte/easing';

    let { onClose } = $props<{ onClose: () => void }>();
    let activeSection = $state('concepts');

    const SECTIONS = [
        {
            id: "concepts",
            title: "Workspace Concepts",
            content: `## Projects
A project is your top-level container for a creative work. Each project has:
- **Bedrock**: Core canon and world rules — ALWAYS injected into every sculptor and chisel prompt
- **The Grain**: High-level narrative structure, also included as context

## Crystals (Documents)
Crystals are your primary writing documents — chapters, scenes, drafts. They live in the sidebar under your project and can be organized into folders.
- The center editor supports markdown with live preview
- When a crystal is selected, the AI chat automatically uses it as context
- Use folders to organize by act, section, or however you prefer

## Artifacts (Wiki Entries)
Artifacts are your project encyclopedia — characters, locations, factions, magic systems, items. They work like wiki pages.
- The AI automatically retrieves relevant artifacts when you mention them in chat
- Each artifact can have **aliases** (comma-separated) so the AI recognizes different names
- In **Carve mode**, the AI can create and edit artifacts directly
- Artifacts support keyword search AND semantic (meaning-based) search

## Veins (Timelines / DAGs)
Veins are visual directed acyclic graphs for plotting your story's connective tissue.
- **Nodes** represent events, scenes, or plot points
- **Edges** represent causality, sequence, or relationships between events
- Nodes can be tagged with artifact references for cross-linking
- Nodes can reference a crystal document for deeper content
- Veins are included in RAG context — the AI can retrieve relevant events
- Apply **Reliefs** (templates) to quickly scaffold common structures

## Studio (Chat)
Each crystal, artifact, or vein gets its own AI chat session attached to a glyph (AI persona).
- Use **@mentions** in the input to pin specific crystals or artifacts as context
- Attach files from disk via the paperclip button
- The context token estimate in the header shows a live breakdown on hover`,
        },
        {
            id: "modes",
            title: "Studio Modes",
            content: `## Inspect Mode (Ask)
Default mode. Single-turn Q&A with RAG (retrieval-augmented generation).
- The AI reads your current crystal, relevant artifacts, vein context, bedrock, and the grain
- Great for brainstorming, getting feedback, asking "what if" questions
- No tools — the AI can only read, not modify your project

## Carve Mode (Agent)
Full tool-using AI mode. The AI can search, read, create, update, and delete project entities.
- **17 tools** across artifacts, veins, documents, search, link resolution, and chisel delegation
- **Risky actions** (delete operations, large rewrites) require your approval via an inline confirmation prompt
- Multi-turn: the AI can chain multiple tool calls in a single response
- Safety cap of 20 tool iterations per message (8 per chisel inner loop) to prevent runaway loops
- After carving actions, the sidebar automatically refreshes

### Available Tools
| Tool | Risk | Description |
|------|------|-------------|
| search_artifacts | Safe | Token-based keyword + embedding RAG search across wiki entries and documents |
| read_artifact | Safe | Read full content of a wiki entry |
| create_artifact | Normal | Create a new wiki entry |
| update_artifact | Normal | Edit an existing wiki entry |
| delete_artifact | **Risky** | Permanently delete a wiki entry |
| read_timeline | Safe | Read vein graph (nodes + edges) |
| create_timeline_node | Normal | Add event node to a vein |
| update_timeline_node | Normal | Edit a vein node |
| delete_timeline_node | **Risky** | Delete node + connected edges |
| create_edge | Normal | Connect two vein nodes (auto-layouts DAG) |
| auto_layout_dag | Safe | Reposition all nodes using layered DAG layout |
| delete_edge | **Risky** | Remove a connection |
| read_draft | Safe | Read current document content |
| append_to_draft | Normal | Append text to active document |
| search_project | Safe | Token-based keyword + embedding RAG search across all entities |
| resolve_dead_links | Normal | Find dead [[wikilinks]] in a document and create stub artifacts |
| delegate_to_specialist | Normal | Delegate a task to a chisel sub-agent glyph |
| delegate_fan_out | Normal | Run multiple chisels in parallel |

## Blueprint Mode (Plan)
Propose-then-execute mode. The AI creates a structured plan of tool calls for your review.
- The AI outputs a checklist of proposed actions with rationale for each
- You can approve/reject individual steps
- Click "Execute" to run the approved steps sequentially
- All steps get confirmation UI regardless of risk level (that's the point of blueprint mode)
- Great for complex operations where you want full control`,
        },
        {
            id: "glyphs",
            title: "Glyphs (Personas)",
            content: `## What are Glyphs?
Glyphs are configurable AI personas that control the behavior of your Studio sessions. Each glyph has:
- **Name**: Display name for the persona
- **System Instruction**: The base prompt that shapes the AI's personality and capabilities
- **Model**: Which AI model to use (Gemini, GPT-4, Claude, etc.)
- **Provider**: Which LLM provider to use (Gemini, OpenAI-compatible, Anthropic)
- **Temperature**: Controls creativity/randomness (0 = focused, 1 = creative)
- **Max Output Tokens**: Maximum response length
- **Sculptor toggle**: Whether this glyph appears in the Studio picker
- **Chisel Tag**: Optional role tag for chisel glyphs (e.g. "researcher", "continuity")

## Sculptors vs Chisels
- **Sculptors** are the entry-point glyphs shown in the Studio glyph picker. They run top-level chat sessions and can delegate work to chisels.
- **Chisels** are sub-agent templates that do NOT appear in the picker. They are invoked via the delegate_to_specialist or delegate_fan_out tools during a Carve mode session.
- Existing glyphs without these fields default to Sculptor (backward-compatible).

## How Delegation Works
In Carve mode, a Sculptor can call delegate_to_specialist with a chisel glyph ID and a task description. The system runs a nested agent loop using the chisel's provider, model, system instruction, and config. The chisel can use all standard tools (but cannot delegate further). Results are returned to the Sculptor as a tool result.

For parallel delegation, the Sculptor can call delegate_fan_out with multiple chisel/task pairs. All run concurrently and results are collected.

### Limits
- **Outer loop (Sculptor)**: 20 iterations max
- **Inner loop (each Chisel)**: 8 iterations max
- Risky actions by chisels still require user confirmation

## Example Chisel Roles
- **Researcher**: Deep-dives into artifacts and veins for context gathering
- **Continuity**: Checks existing lore and flags inconsistencies
- **Architect**: Manages DAG structures and event creation
- **Editor**: Reviews and polishes crystal drafts

## Creating Glyphs
Navigate to the Glyph Registry page to create custom personas. Uncheck "Sculptor (Show in Studio)" to make a glyph a chisel template.`,
        },
        {
            id: "polisher",
            title: "The Polisher",
            content: `## The Polisher (Multi-Generation Refining)
The Polisher is a multi-generation text manipulation tool designed for non-chat completion models (like Llama 3.1 405B) and creative refinement workflows.

### How It Works
1. **Select text** in the editor (or place your cursor for forward-generation)
2. **Open The Polisher** via the floating "Polish" button or \`Ctrl+Shift+P\` / \`Cmd+Shift+P\`
3. **Three parallel generations** ("Facets") stream in simultaneously on the left
4. **Click "Use"** on any facet to import its text into the Polishing Wheel on the right
5. **Mix, edit, and refine** the imported text freely in the Polishing Wheel
6. **Click "Apply Polish"** to inject the final text back into your document

### Modes
- **Rewrite mode**: When text is selected, each facet produces a variation of the selected passage that fits the surrounding context
- **Forward-generation mode**: When no text is selected, each facet continues writing from the cursor position

### Setup
1. Go to the **Glyph Registry**
2. Create or select a Glyph configured for your preferred completion model
3. Enable the **Completion Engine** toggle if your model uses raw \`/completions\` endpoints (e.g., Llama via OpenRouter, vLLM, or Ollama)
4. Enable the **Polisher Engine** toggle to designate it as the generation engine for The Polisher

### Polisher vs Basic Infill
| Feature | Basic Infill | The Polisher |
|---------|-------------|-------------|
| Generations | Single | 3 parallel |
| Model | Default (Gemini Flash) | Dedicated Polisher Glyph |
| Editing | Direct replacement | Interactive mixing wheel |
| Best for | Quick rewrites | Deliberate prose refinement |
| Shortcut | Click "Rewrite / Infill" | \`Ctrl+Shift+P\` or "Polish" button |`,
        },
        {
            id: "shortcuts",
            title: "Keyboard Shortcuts",
            content: `## Global
| Shortcut | Action |
|----------|--------|
| \`⌘K\` / \`Ctrl+K\` | Open command palette |
| \`⌘1\` / \`Ctrl+1\` | Focus editor pane |
| \`⌘2\` / \`Ctrl+2\` | Focus chat input |

## Studio
| Shortcut | Action |
|----------|--------|
| \`Enter\` | Send message |
| \`Shift+Enter\` | New line in message |
| \`@\` | Trigger mention autocomplete for crystals & artifacts |

## Editor
| Shortcut | Action |
|----------|--------|
| \`⌘+Shift+P\` / \`Ctrl+Shift+P\` | Open The Polisher |
| Standard text editing | Supported in the markdown editor |

## Command Palette
| Action | Description |
|--------|-------------|
| Search | Find any crystal, artifact, or vein by name |
| Navigate | Jump to any entity across your project |`,
        },
        {
            id: "context",
            title: "Context & RAG",
            content: `## The 5-Pillar Context Engine
Every message you send through Studio assembles context from five sources before reaching the AI:

### 1. Bedrock + Grain (System Instruction)
Your project's Bedrock (core canon) and Grain (story outline) are always injected into the system instruction. This provides the AI with permanent knowledge about your world.

### 2. Conversation History
The full branch of messages from the current chat session is included, allowing multi-turn reasoning.

### 3. Artifact RAG (Wiki)
The system automatically retrieves relevant artifacts based on:
- **Keyword matching**: If a wiki entry's title or aliases appear in your recent messages or current draft
- **Semantic search**: Embedding-based similarity finds related entries even without exact name matches
- Results are deduplicated and injected as context

### 4. Vein RAG (Timeline Events)
Timeline event titles, content, and summaries are embedded in the RAG index. When you're working on a vein or mentioning related events, they are retrieved as context.

### 5. Draft Windowing
When editing a crystal, a windowed excerpt of the current document (focused around your cursor position) is included as context.

## Live Token Estimate
The CTX indicator in the Studio header shows an estimated token count. Hover over it to see a breakdown of each context component (History, Artifacts, Veins, Draft, System + Bedrock).

## @Mentions
Type \`@\` in the Studio input to pin specific crystals or artifacts as context. These are injected directly into your message, ensuring the AI sees the full content of the mentioned entity regardless of RAG scoring.`,
        },
        {
            id: "obsidian",
            title: "Obsidian Compatibility",
            content: `## Obsidian Vault Support
Rhyolite can use an Obsidian vault as its project directory. Your .md files are readable and editable in both apps.

## How It Works
- **Title-based filenames**: Crystals and artifacts are saved as \`Title.md\` (e.g. \`The Four Powers.md\`) instead of random IDs
- **ID in frontmatter**: Each file stores its internal Rhyolite ID in YAML frontmatter, keeping the file linkable even if renamed
- **\`[[Wikilinks]]\`**: Double-bracket links (\`[[Character Name]]\` or \`[[Title|display text]]\`) and standard markdown links (\`[Display](<Target>)\`) are recognized as entity references and rendered as clickable links
- **Metadata in \`.rhyolite/\`**: Project config lives in \`.rhyolite/project.json\`, keeping Obsidian's root clean

## Open Folder
In the project dropdown, select **Open Folder...** to open a native OS folder picker. Rhyolite will:
- Register the folder natively via \`known-projects.json\`
- Scan subdirectories directly, creating matching folders in the sidebar
- File operations (move, rename, delete) reflect immediately on disk

## Dead Link Resolver
The **Resolve [[links]]** button in the document editor scans the active crystal for \`[[wikilinks]]\` that don't point to any existing artifact or document.
- It runs a **3-stage chisel pipeline** (Researcher → Writer → Auditor) with live streaming progress
- Creates fully-fleshed, template-compliant articles using RAG context
- Configure the \`researcher\`, \`writer\`, and \`auditor\` chisel glyphs to tune behavior
- Also available as the \`resolve_dead_links\` tool in Carve mode`,
        },
        {
            id: "naming",
            title: "Naming Guide",
            content: `## Rhyolite Naming Conventions
The interface uses a stone/crafting theme. Here's a quick reference:

| Term | Meaning |
|------|---------|
| **Crystal** | A document (chapter, scene, draft) |
| **Artifact** | A wiki entry (character, location, lore) |
| **Vein** | A timeline / DAG graph |
| **Glyph** | An AI persona configuration |
| **Sculptor** | A top-level glyph shown in the Studio picker |
| **Chisel** | A specialist sub-agent glyph for delegation |
| **Studio** | The chat/comms panel |
| **Bedrock** | Core canon / lore bible (always-on context) |
| **The Grain** | Story outline (narrative structure context) |
| **Quarry** | The global network graph view |
| **Relief** | A DAG template / scaffold |
| **Facet Editor** | The node property editor in veins |
| **Inspect** | Read-only Q&A mode (formerly "Ask") |
| **Blueprint** | Plan-then-execute mode (formerly "Plan") |
| **Carve** | Full agent tool-use mode (formerly "Agent") |

## Why These Names?
- **Crystals** are formed, polished, and can be cut or reshaped — like your prose
- **Artifacts** are discovered objects with history — like your world's lore entries
- **Veins** run through rock carrying minerals, connecting points — like your timeline graphs
- **Glyphs** are carved symbols with meaning — like your AI persona configurations
- **Sculptors** shape the stone at the highest level — your primary AI personas
- **Chisels** are the precision tools used by sculptors — your specialist sub-agents
- **Studio** is where raw material becomes refined output — your chat interface
- **Bedrock** is the immovable foundation — your core canon that never changes
- **The Grain** is the natural direction of the stone — your narrative structure
- **Quarry** is where you see all the raw material at once — your global graph view`,
        },
        {
            id: "features",
            title: "Additional Features",
            content: `## Reasoning Display
Toggle the brain icon in the Studio controls to see the AI's thinking process (when supported by the model). This uses provider-native reasoning features and shows the AI's chain of thought in a collapsible block.

## @Mention Autocomplete
Type \`@\` in the Studio input to search and pin project entities:
- Crystals and artifacts appear in a dropdown as you type
- Selected items are pinned as chips above the input
- Their full content is injected into your message for guaranteed context

## File Attachments
Attach files to chat messages:
- Use the paperclip button to open a file picker
- Text files are included as context in the message

## Context Token Estimate
Hover over the token indicator in the Studio header to see a breakdown of how your context window is being used (history, artifacts, veins, draft, system + bedrock).

## Branch/Fork System
Studio supports branching conversations:
- Each user message can have multiple AI responses
- Navigate between branches using the ← / → controls
- Regenerate responses to explore different AI outputs

## Error Handling
The system displays inline warnings for:
- **Rate limits**: Shows retry information
- **Auth errors**: Prompts to check API key
- **Provider errors**: Shows error details

## Quarry (Global Network Graph)
The Quarry renders an interactive force-directed graph of all entities in your project. Crystals, artifacts, and veins are shown as connected nodes based on cross-references and wikilinks.`,
        },
    ];

    let section = $derived(SECTIONS.find(s => s.id === activeSection) ?? SECTIONS[0]);

    function renderContent(content: string): string {
        const html = marked.parse(content, { gfm: true, breaks: true }) as string;
        return DOMPurify.sanitize(html);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" onclick={onClose} transition:fade={{ duration: 150 }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="flex h-[80vh] w-[90vw] max-w-4xl flex-col border border-violet-600/60 bg-[#020005] shadow-2xl shadow-violet-900/20 rounded-lg overflow-hidden" onclick={(e) => e.stopPropagation()} transition:scale={{ duration: 300, start: 0.95, easing: backOut }}>
        <div class="flex items-center justify-between border-b border-violet-600/40 px-4 py-2 bg-black/40">
            <div class="flex items-center gap-3">
                <span class="text-violet-500 font-mono text-xs">&gt;_</span>
                <h2 class="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400">
                    Documentation
                </h2>
            </div>
            <button
                onclick={onClose}
                class="border border-violet-800/60 bg-black px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-400 hover:border-violet-600 hover:text-violet-200 rounded-md transition-colors"
            >
                <X size={12} />
            </button>
        </div>

        <div class="flex min-h-0 flex-1">
            <nav class="flex w-48 shrink-0 flex-col border-r border-violet-800/40 bg-black/50 py-2 overflow-y-auto">
                {#each SECTIONS as s}
                    <button
                        class="px-4 py-2 text-left text-[10px] font-mono uppercase tracking-wider transition-colors {
                            activeSection === s.id
                                ? 'bg-violet-900/30 text-violet-200 border-l-2 border-violet-400'
                                : 'text-violet-600 hover:text-violet-400 hover:bg-violet-950/30 border-l-2 border-transparent'
                        }"
                        onclick={() => activeSection = s.id}
                    >
                        {s.title}
                    </button>
                {/each}
            </nav>

            <div class="flex-1 overflow-y-auto px-6 py-4">
                <div class="prose prose-invert prose-violet max-w-none text-xs leading-relaxed
                    [&_h2]:text-violet-300 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:mt-6 [&_h2]:mb-3
                    [&_h3]:text-violet-400 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:mt-4 [&_h3]:mb-2
                    [&_p]:text-violet-300/90 [&_p]:mb-3
                    [&_strong]:text-violet-200
                    [&_li]:text-violet-300/90 [&_ul]:mb-3
                    [&_table]:text-[10px] [&_th]:text-violet-400 [&_th]:border-violet-800/60 [&_td]:border-violet-800/40 [&_td]:text-violet-300
                    [&_code]:text-violet-400 [&_code]:bg-violet-950/40 [&_code]:px-1 [&_code]:text-[10px]
                    [&_table]:w-full [&_table]:border-collapse [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:border [&_td]:px-2 [&_td]:py-1 [&_td]:border"
                >
                    {@html renderContent(section.content)}
                </div>
            </div>
        </div>
    </div>
</div>
