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
A **project** is the top-level container for everything in Rhyolite. When you create or open a project, all crystals, artifacts, veins, and studio sessions live under it. Each project has two special fields configured in **Project Settings**:

- **Bedrock** (Core Canon / Lore Bible): The foundational rules of your world — magic systems, physical laws, faction structures, anything that should never be contradicted. Bedrock is **always injected** into the system instruction for every sculptor and chisel prompt, ensuring the AI never violates your canon.
- **The Grain** (Story Outline): Your high-level narrative structure — act breakdowns, chapter summaries, character arcs. Also **always injected** as context alongside Bedrock.

Both fields are plain text. Edit them in Project Settings (click the project name in the sidebar header).

---

## Crystals (Documents)
Crystals are your primary writing files — chapters, scenes, drafts, notes. They are stored as \`.md\` markdown files and organized in folders via the sidebar.

### The Editor
The center editor provides a **split-pane view** with three modes:
- **Split** (default): Markdown editor on the left, live rendered preview on the right
- **Write-only**: Full-width markdown editor, no preview
- **Read-only**: Full-width rendered preview, no editor

Toggle between modes using the view buttons in the editor toolbar.

### Markdown Support
Crystals support standard markdown (headings, bold, italic, lists, blockquotes, horizontal rules, code) plus:
- **\`[[Wikilinks]]\`**: Link to other crystals or artifacts by title. Example: \`[[Character Name]]\`
- **\`[[Title|display text]]\`**: Wikilink with custom display text
- **\`[display text](<Target>)\`**: Standard markdown link syntax also recognized as entity references
- All wikilink formats render as clickable links in the preview pane

### Entity Link Suggestions
The **bottom bar** of the editor automatically detects mentions of artifact names and aliases in your text. When a potential link is found, it appears as a clickable suggestion — click it to wrap the mention in \`[[wikilinks]]\` automatically.

### Dead Link Detection
In the rendered preview, any \`[[wikilink]]\` that does not resolve to an existing artifact or crystal is shown with a **dashed red border**. Use the **Resolve [[links]]** button in the toolbar to auto-create stub artifacts for all dead links (via a 3-stage chisel pipeline), or fix them manually.

### Editor Toolbar
The toolbar provides buttons for: **Bold**, **Italic**, **Heading**, **List**, **Blockquote**, and **Horizontal Rule**. These insert the corresponding markdown syntax at the cursor position.

### Auto-Save
Every edit is saved automatically after a **400ms debounce** — you never need to manually save.

---

## Artifacts (Wiki Entries)
Artifacts are your project encyclopedia — characters, locations, factions, magic systems, items, any lore entry. They function like wiki pages.

- **Aliases**: Each artifact supports comma-separated aliases (e.g., \`"The Dark One, Malthus, The Shattered King"\`). The RAG engine recognizes all aliases when matching context, so the AI finds the right artifact regardless of which name you use.
- **Keyword Search**: Title and alias word tokens (words with 3+ characters) are matched against recent messages and the active draft.
- **Semantic Search**: Embedding-based similarity search (top 8 results) finds related entries even without exact name matches. Results are deduplicated with keyword matches.
- **AI CRUD**: In **Carve mode**, the AI can search, read, create, update, and delete artifacts directly using tools.

---

## Veins (Timelines / DAGs)
Veins are **visual directed acyclic graphs** for plotting causality, story structure, research flows, or any connected system.

### Nodes
Each node has:
- **Type**: Event, Lore, Scene, or Reference (determines the icon/badge)
- **Color**: Customizable per node; edges inherit the color of their source node
- **Tags**: Freeform tags for categorization and cross-referencing
- **Summary**: Short description shown on the node
- **Full Content**: Extended content accessible in the facet editor (node property panel)
- **Reference**: Nodes can link to a crystal or artifact — Reference-type nodes are created automatically when you **drag-and-drop** a document or wiki entry from the sidebar onto the canvas

### Edges
Edges represent causality, sequence, or relationships. Each edge has an optional **label** (e.g., "causes", "leads to", "contradicts") and visually inherits the **color of its source node**.

### Canvas Interactions
- **Double-click** on empty canvas to add a new node
- **Drag-and-drop** crystals or artifacts from the sidebar to create Reference nodes
- **Backspace / Delete** key removes selected nodes
- **Dagre auto-layout** repositions all nodes in a clean layered DAG arrangement

### Relief Templates
Five built-in Relief templates provide instant scaffolding:
1. **Three-Act Structure** — Setup, confrontation, resolution with key plot beats
2. **Character Arc** — Ordinary world through transformation to new normal
3. **Research Methodology** — Question, literature review, methodology, analysis, conclusions
4. **Argument Chain** — Thesis, premises, evidence, counterarguments, synthesis
5. **Cause-Effect Analysis** — Inciting incident through cascading consequences

Apply a Relief from the \`[ Relief ]\` button in the canvas toolbar.

---

## Studio (Chat)
The Studio is the AI chat panel. Each entity (crystal, artifact, or vein) gets its own **per-entity chat session** attached to a glyph (AI persona).

- **@Mentions**: Type \`@\` in the input to search and pin specific crystals or artifacts. Pinned items appear as chips above the input and their **full content** is injected into the message, guaranteeing the AI sees them regardless of RAG scoring.
- **File Attachments**: Click the paperclip button to attach text files from disk. File contents are injected as context in the message.
- **Live Context Token Estimate**: The CTX indicator in the Studio header shows an estimated token count. **Hover** to see a breakdown: History, Artifacts, Veins, Draft, System + Bedrock, and Total.
- **Branch/Fork System**: Each user message can have **multiple AI responses**. Navigate between siblings with the **left/right arrow** controls. Regenerate to get a new response. Edit a user message to fork the conversation into a new branch.
- **Message Editing**: Click the edit button on any user message to modify it and re-run the AI response, creating a new conversation fork.
- **Message Deletion**: Delete a message and all its descendants from the branch.
- **Copy to Clipboard**: Copy any model response as markdown text.

---

## Quarry (Global Network Graph)
The Quarry renders an interactive force-directed graph of **all entities** in your project:

- **Documents** (Crystals) appear as **amber** nodes
- **Wiki Entries** (Artifacts) appear as **cyan** nodes
- **Timeline Events** appear as **purple** nodes
- **Edges** are drawn from wikilinks, cross-references, tags, and timeline connections

### Controls
- **Zoom**: Range from 0.05x to 4x magnification
- **Fit**: Button to auto-fit all nodes in view
- **Auto-layout**: Force-directed positioning
- **MiniMap**: Overview panel for navigation in large graphs
- Click any node to navigate to that entity`,
        },
        {
            id: "modes",
            title: "Studio Modes",
            content: `Rhyolite provides five distinct Studio modes, each controlling how the AI interacts with your project.

## Inspect Mode (Ask)
Read-only Q&A with full RAG context. The AI receives your current crystal, relevant artifacts, vein context, Bedrock, and The Grain — but has **no tools**. It cannot modify anything in your project.

Best for: brainstorming, getting feedback, asking "what if" questions, checking continuity, exploring ideas without risk.

---

## Carve Mode (Agent)
Full tool-using agent mode. The AI can search, read, create, update, and delete project entities across **22 tools**.

- **Multi-turn**: The AI can chain multiple tool calls in a single response, reasoning between each call
- **Risky action confirmation**: Any tool classified as **Risky** (deletes, destructive operations) pauses execution and presents an inline confirmation prompt — you must approve or reject before the tool runs
- **Iteration safety cap**: Maximum **30 outer iterations** (sculptor level) and **12 inner iterations** (per chisel) to prevent runaway loops
- **Auto-refresh**: After any tool modifies project data, the sidebar automatically refreshes to reflect changes

### Complete Tool Reference (22 Tools)

| Tool | Risk | Description |
|------|------|-------------|
| \`search_artifacts\` | Safe | Keyword + embedding RAG search across wiki entries |
| \`read_artifact\` | Safe | Read full content of a wiki entry by ID |
| \`create_artifact\` | Normal | Create a new wiki entry with title, content, and optional aliases |
| \`update_artifact\` | Normal | Edit an existing wiki entry's title, content, or aliases |
| \`delete_artifact\` | **Risky** | Permanently delete a wiki entry |
| \`search_project\` | Safe | Keyword + embedding RAG search across all entity types |
| \`read_draft\` | Safe | Read the content of the active crystal document |
| \`append_to_draft\` | Normal | Append text to the end of the active document |
| \`write_draft\` | Normal | Overwrite the active document with new content |
| \`replace_in_draft\` | Normal | Find and replace a specific text span in the active document |
| \`create_document\` | Normal | Create a new crystal document with title and content |
| \`delete_document\` | **Risky** | Permanently delete a crystal document |
| \`move_file\` | Normal | Move a document or wiki entry to a different folder |
| \`read_timeline\` | Safe | Read the full vein graph (all nodes and edges) |
| \`create_timeline_node\` | Normal | Add a new node to the active vein |
| \`update_timeline_node\` | Normal | Edit a vein node's properties (title, type, content, color, tags, etc.) |
| \`delete_timeline_node\` | **Risky** | Delete a node and all its connected edges |
| \`create_edge\` | Normal | Connect two vein nodes with an optional label (auto-layouts the DAG) |
| \`delete_edge\` | **Risky** | Remove a connection between two nodes |
| \`auto_layout_dag\` | Safe | Reposition all nodes using layered Dagre layout algorithm |
| \`resolve_dead_links\` | Normal | Find dead \`[[wikilinks]]\` in a document and create stub artifacts |
| \`delegate_to_specialist\` | Normal | Delegate a task sequentially to a chisel sub-agent |
| \`delegate_fan_out\` | Normal | Run multiple chisel sub-agents in parallel |

In **Plan mode only**, one additional tool is available:

| Tool | Risk | Description |
|------|------|-------------|
| \`propose_plan\` | Safe | Propose a structured plan of tool calls for user review |

### Risk Levels Explained
- **Safe**: Read-only operations. No confirmation needed. Cannot modify project data.
- **Normal**: Creates or modifies data. Executes immediately without confirmation. Reversible in most cases.
- **Risky**: Destructive operations (deletes, large overwrites). **Always requires explicit user confirmation** via an inline approve/reject prompt before execution.

---

## Blueprint Mode (Plan)
Propose-then-execute mode. Instead of acting immediately, the AI creates a **structured checklist** of proposed tool calls with rationale for each step.

- The AI outputs a plan using the \`propose_plan\` tool — this is the only tool available in Blueprint mode
- Each step shows the tool name, arguments, and the AI's reasoning
- You can **approve or reject individual steps** before execution
- Click **Execute** to run all approved steps sequentially
- All steps get confirmation UI regardless of their normal risk level — that is the point of Blueprint mode
- Best for: complex multi-step operations where you want full visibility and control before anything changes

---

## Write Mode
An automated **3-stage content generation pipeline** that auto-discovers chisel sub-agents tagged as \`researcher\`, \`writer\`, and \`auditor\`.

### How It Works
1. You send a message in Write mode
2. The system auto-discovers chisels tagged \`researcher\`, \`writer\`, and \`auditor\` from the Glyph Registry
3. **Researcher** runs first with read-only tools — gathers lore, context, and relevant material
4. **Writer** runs next with draft-writing tools — produces prose and writes it to the document via \`write_draft\`
5. **Auditor** runs last with read + replace tools — reviews the written content, fixes specific issues via \`replace_in_draft\`
6. The **sculptor** (your main glyph) receives a summary of what was written — it does NOT repeat or paste the content into chat

### Pipeline Progress UI
A **teal progress bar** shows pipeline advancement. Each chisel stage displays as an expandable card showing the chisel's name, role, and streaming output. Step indicators show which stage is active.

### Role-Locked Tools
Each stage only has access to the tools appropriate for its role:
- **Researcher**: \`search_artifacts\`, \`read_artifact\`, \`read_draft\`, \`search_project\`, \`read_timeline\`, \`resolve_dead_links\`
- **Writer**: All researcher tools PLUS \`write_draft\`, \`append_to_draft\`, \`replace_in_draft\`, \`create_document\`
- **Auditor**: All researcher tools PLUS \`replace_in_draft\`, \`read_draft\`

See the dedicated **Write Mode Pipeline** section for setup instructions and tips.

---

## Research Mode
Runs the sculptor's **custom pipeline** as configured in the glyph's pipeline settings. Unlike Write mode (which always uses researcher/writer/auditor), Research mode uses whatever ordered list of chisel tags you define in the glyph configuration.

- Configure the pipeline in the Glyph Registry by adding an ordered list of chisel tags (e.g., \`["researcher", "analyst", "synthesizer"]\`)
- Each tag is matched to a chisel with that \`specialistRole\`
- Pipeline chisels run sequentially, each receiving cumulative context from prior steps
- After the pipeline completes, results are injected as context for the sculptor's final generation
- If no pipeline is defined for the active sculptor, Research mode falls back to standard generation

Best for: custom multi-agent workflows, deep research tasks, analysis pipelines tailored to your specific needs.`,
        },
        {
            id: "glyphs",
            title: "Glyphs (Personas)",
            content: `## What Are Glyphs?
Glyphs are configurable AI personas that control every aspect of your Studio sessions. Navigate to the **Glyph Registry** page to create and manage them.

### Full Configuration Options
Every glyph has the following settings:

| Setting | Description |
|---------|-------------|
| **Name** | Display name shown in the Studio picker and pipeline progress |
| **Provider** | LLM provider: \`gemini\`, \`openai\` (OpenAI-compatible), or \`anthropic\` |
| **Model** | Specific model ID (e.g., \`gemini-2.0-flash\`, \`gpt-4o\`, \`claude-sonnet-4-20250514\`) |
| **Temperature** | Controls creativity/randomness. Range 0.0 to 2.0 (step 0.05). Lower = more focused, higher = more creative |
| **Output Length** | Maximum response length in tokens |
| **System Instruction** | The base prompt that shapes the AI's personality, writing style, and capabilities |
| **Role Description** | Human-readable description of what this glyph does |

### Toggle Options

| Toggle | Effect |
|--------|--------|
| **Sculptor (Show in Studio)** | When enabled, this glyph appears in the Studio glyph picker as a selectable persona. When disabled, the glyph is a chisel (sub-agent only). |
| **Chisel Tag** | The specialist role tag (e.g., \`researcher\`, \`writer\`, \`auditor\`, \`continuity\`, \`architect\`). Used by Write mode auto-discovery and Research mode pipelines. |
| **Polisher Engine** | Designates this glyph as the generation engine for **The Polisher**. Only one glyph should have this enabled. The Polisher uses this glyph's model, temperature, and system instruction. |
| **Completion Engine** | Enables raw \`/completions\` endpoint usage for non-chat models (e.g., Llama via OpenRouter, vLLM, or Ollama). When enabled, the model receives a text prompt rather than a chat message array. |
| **Pipeline** | An ordered list of chisel tags for Research mode. Only relevant for sculptors. Defines the sequence of specialist stages that run before final generation. |

---

## Sculptors vs Chisels
- **Sculptors** are entry-point glyphs shown in the Studio picker. They run top-level chat sessions and can delegate work to chisels. When you select a glyph in the Studio header, you are choosing a sculptor.
- **Chisels** are specialist sub-agent glyphs that do NOT appear in the picker. They are invoked during Carve mode (via \`delegate_to_specialist\` or \`delegate_fan_out\`) or automatically during Write/Research pipeline stages.
- A glyph defaults to Sculptor if no sculptor/chisel fields are set (backward-compatible).

---

## How Delegation Works

### Sequential Delegation (\`delegate_to_specialist\`)
In Carve mode, a sculptor can call \`delegate_to_specialist\` with a chisel glyph ID and a task description. The system spawns a **nested agent loop** using the chisel's own provider, model, system instruction, and configuration. The chisel can use all standard tools (minus delegation tools — chisels cannot delegate further). Results are returned to the sculptor as a tool result.

### Parallel Delegation (\`delegate_fan_out\`)
The sculptor can call \`delegate_fan_out\` with multiple chisel/task pairs. All chisels run **concurrently** and their results are collected and returned together.

### Iteration Limits
- **Outer loop (Sculptor)**: Maximum **30 iterations** per message
- **Inner loop (each Chisel)**: Maximum **12 iterations** per delegation
- Risky actions by chisels still require user confirmation — they bubble up to the main UI

---

## Common Chisel Roles
These are suggested roles, but you can create any specialist:

| Tag | Purpose |
|-----|---------|
| \`researcher\` | Deep-dives into artifacts and veins for context gathering. Read-only tools in Write mode. |
| \`writer\` | Produces prose and writes to documents. Gets draft-writing tools in Write mode. |
| \`auditor\` | Reviews written content, checks for issues, applies targeted fixes. Gets read + replace tools in Write mode. |
| \`continuity\` | Checks existing lore and flags inconsistencies across artifacts and timelines. |
| \`architect\` | Manages DAG structures, creates events, builds timeline scaffolding. |

### Write Pipeline Role-Locked Tools
When chisels run inside the Write mode pipeline, their tools are restricted based on their tag:
- **Researcher**: \`search_artifacts\`, \`read_artifact\`, \`read_draft\`, \`search_project\`, \`read_timeline\`, \`resolve_dead_links\`
- **Writer**: All researcher tools + \`write_draft\`, \`append_to_draft\`, \`replace_in_draft\`, \`create_document\`
- **Auditor**: All researcher tools + \`replace_in_draft\`, \`read_draft\`

---

## Creating Glyphs
1. Navigate to the **Glyph Registry** page (click the glyph icon in the sidebar)
2. Click **New Glyph** to create a new persona
3. Configure provider, model, system instruction, and temperature
4. To make it a **sculptor**: leave "Sculptor (Show in Studio)" checked
5. To make it a **chisel**: uncheck "Sculptor (Show in Studio)" and set the **Chisel Tag** to the desired role
6. To use it with **The Polisher**: enable the "Polisher Engine" toggle
7. For non-chat completion models: enable the "Completion Engine" toggle`,
        },
        {
            id: "polisher",
            title: "The Polisher",
            content: `## Overview
The Polisher is a **multi-generation text refinement tool** with a branching tree of variations. It is designed for deliberate prose crafting — generating multiple alternatives, drilling into the best branches, mixing results, and iterating until you have exactly the text you want.

---

## How to Open
- **Select text** in the editor, then click the floating **"Polish"** button that appears
- Or press \`Cmd+Shift+P\` / \`Ctrl+Shift+P\` at any time
- If text is selected: **Rewrite mode** (each facet produces a variation of the selection)
- If no text is selected (cursor only): **Forward-generation mode** (each facet continues writing from the cursor position)

---

## The 3-Pane Layout

### Left Pane: Gem Tree (Collapsible)
The Gem Tree is a **branching tree of all generations**. Each node (a "Gem") represents one generated text variant.

- The **root node** contains the initial context (your selected text or cursor position)
- Each generation creates **3 child nodes** under the currently active node
- Click any node to make it active and see its children as facets
- **Focus / Zoom**: Click the zoom icon on a node to narrow the tree view to that subtree. Click again to zoom back out.
- The tree grows deeper as you "Drill" into promising branches, creating an explorable tree of variations

Each GemNode stores: a unique \`id\`, \`parentId\` (linking to parent), \`text\` (the generated content), and \`children\` (child GemNodes).

### Middle Pane: Facets
Facets are the **3 parallel generations** displayed in the center. When you generate (or re-generate), three variants stream in simultaneously.

- **"Use"** button: Imports that facet's text into the Polishing Wheel (right pane) for editing
- **"Drill"** button: Selects that facet's node as the new active node and immediately generates 3 new child variants. This enables **iterative deepening** — you keep drilling into the most promising branch, refining at each level.

### Right Pane: Polishing Wheel
The Polishing Wheel is a **free-text editor** where you mix, edit, and refine text from the facets.

- Import text from any facet via "Use"
- Edit freely — combine parts from multiple facets, rewrite passages, adjust tone
- **Word count** is displayed at the bottom
- Click **"Apply Polish"** to inject the final text back into your editor at the original cursor/selection position

---

## Context Resolution
The Polisher maintains context by **walking from the active node up to the root**, concatenating all branch text along the path. This means deeper nodes carry the cumulative context of their entire ancestry — each generation builds on the creative direction established by its parent, enabling coherent iterative refinement.

---

## Polisher Glyph Configuration
The Polisher requires a glyph with the **"Polisher Engine"** toggle enabled in the Glyph Registry.

- Uses the glyph's **model**, **temperature**, and **system instruction**
- Context is automatically enriched with: the project's **lore bible** (Bedrock), **story outline** (The Grain), and relevant **wiki entries** retrieved via keyword + embedding search (capped at **12,000 characters** of wiki context)
- If the glyph also has **"Completion Engine"** enabled, the Polisher uses the raw \`/completions\` endpoint instead of the chat endpoint — ideal for non-chat models like Llama or other base models via OpenRouter, vLLM, or Ollama

---

## Polisher vs Basic Infill
| Feature | Basic Infill/Rewrite | The Polisher |
|---------|---------------------|-------------|
| Generations | Single | 3 parallel, branching tree |
| Model | Default (Gemini Flash) | Dedicated Polisher Glyph (any provider) |
| Editing | Direct replacement in editor | Interactive Polishing Wheel with mixing |
| Iteration | One-shot | Drill to deepen, unlimited branching |
| Context | Basic surrounding text | Full lore bible + story outline + wiki RAG |
| Best for | Quick rewrites and infills | Deliberate prose refinement and exploration |
| Shortcut | Select text, click "Rewrite / Infill" | \`Cmd+Shift+P\` or "Polish" button |`,
        },
        {
            id: "shortcuts",
            title: "Keyboard Shortcuts",
            content: `## Global Shortcuts
| Shortcut | Action |
|----------|--------|
| \`Cmd+K\` / \`Ctrl+K\` | Open the **command palette** — search and jump to any crystal, artifact, or vein by name |
| \`Cmd+1\` / \`Ctrl+1\` | Focus the **editor pane** |
| \`Cmd+2\` / \`Ctrl+2\` | Focus the **chat input** in Studio |
| \`Escape\` | Close the current modal (documentation, polisher, command palette, etc.) |

## Studio (Chat) Shortcuts
| Shortcut | Action |
|----------|--------|
| \`Enter\` | Send the current message |
| \`Shift+Enter\` | Insert a new line in the message (without sending) |
| \`@\` | Trigger the **mention autocomplete** dropdown to search and pin crystals or artifacts as context |

## Editor Shortcuts
| Shortcut | Action |
|----------|--------|
| \`Cmd+Shift+P\` / \`Ctrl+Shift+P\` | Open **The Polisher** for the current selection or cursor position |
| Standard text editing shortcuts | Cut, copy, paste, undo, redo, select all — all standard shortcuts work in the markdown editor |

## Editor Toolbar Buttons
The toolbar above the editor provides quick-insert buttons:

| Button | Action |
|--------|--------|
| **B** | Insert **bold** markdown (\`**text**\`) |
| **I** | Insert *italic* markdown (\`*text*\`) |
| **H** | Insert heading markdown (\`## \`) |
| **List** | Insert unordered list item (\`- \`) |
| **Quote** | Insert blockquote (\`> \`) |
| **HR** | Insert horizontal rule (\`---\`) |

## Canvas (Vein Editor) Shortcuts
| Shortcut | Action |
|----------|--------|
| \`Backspace\` / \`Delete\` | Delete the currently selected node(s) on the canvas |
| Double-click empty canvas | Add a new node at that position |
| Drag from sidebar | Drop a crystal or artifact onto the canvas to create a Reference node |

## Command Palette
| Action | Description |
|--------|-------------|
| Type to search | Find any crystal, artifact, or vein by name |
| Click result / Enter | Navigate directly to that entity |`,
        },
        {
            id: "context",
            title: "Context & RAG",
            content: `## The 5-Pillar Context Engine
Every message you send through Studio assembles context from **five distinct sources** before reaching the AI model. Understanding these pillars helps you write more effective prompts and control what the AI knows.

---

### Pillar 1: Bedrock + Grain (System Instruction)
Your project's **Bedrock** (core canon / lore bible) and **The Grain** (story outline) are injected into the system instruction of every request. This is permanent, always-on context — the AI can never miss it.

- Set these in **Project Settings** (click the project name in the sidebar)
- Keep Bedrock focused on immutable rules and facts
- Keep The Grain focused on narrative structure and arcs

---

### Pillar 2: Conversation History
The **full branch chain** from the current message tip back to the root of the conversation is included. This is not just the last few messages — it is the entire branch path through the conversation tree, enabling true multi-turn reasoning.

If you have forked conversations, only the active branch is included (not sibling branches).

---

### Pillar 3: Artifact RAG (Wiki Entries)
The system automatically retrieves relevant wiki entries using a **two-stage pipeline**:

**Stage 1 — Keyword Matching**:
- The system takes your 3 most recent messages and the last 4,000 characters of the active draft as search corpus
- Each wiki entry's **title** and **aliases** (comma-separated) are tokenized into individual words
- Words with **3 or more characters** are matched against the search corpus
- Full title/alias substring matches are also checked
- Any match adds that wiki entry to the context

**Stage 2 — Semantic (Embedding) Search**:
- Your 2 most recent messages are used as an embedding query
- The system retrieves the **top 8** most semantically similar entries from the vector index
- Results are **deduplicated** against keyword matches to avoid injecting the same entry twice

All matched wiki entries are injected as RAG context, capped at **12,000 characters** total to stay friendly to smaller models.

---

### Pillar 4: Vein RAG (Timeline Events)
When you are working on a vein (timeline) and have an active node selected:

- The **active node's** full content is included
- A **BFS (breadth-first search) backward traversal** walks up to **10 hops** from the active node through parent edges, collecting all ancestor nodes
- Ancestor node summaries (or full content if \`passFullContent\` is enabled) are included
- **Logical relationships** (DAG edges with labels) between nodes in the subgraph are included, showing the causal/sequential chain leading to the active event

This gives the AI a rich understanding of "how we got here" in the narrative timeline.

---

### Pillar 5: Draft Windowing
When editing a crystal (document), the current document content is included as context. For large documents:

- Documents under **2,000 words**: Full content is included
- Documents over **2,000 words**: A **windowed excerpt** is extracted:
  - **Opening**: First 500 words
  - **Cursor Region**: 1,500 words centered on your cursor position (750 words before and after)
  - **Ending**: Last 500 words
  - Gaps between windows are marked with \`[...]\` separators

This ensures the AI always sees the beginning, end, and your current working area, even in very long documents.

---

## Live Token Estimate
The **CTX** indicator in the Studio header shows a real-time estimated token count for the context that will be sent with your next message. **Hover** over it to see a detailed breakdown:

| Component | What It Measures |
|-----------|-----------------|
| History | Character count of conversation branch |
| Artifacts | Character count of retrieved wiki entries |
| Veins | Character count of timeline DAG context |
| Draft | Character count of document windowed excerpt |
| System + Bedrock | Character count of system instruction, Bedrock, and Grain |
| Total | Sum of all components |

---

## @Mentions (Guaranteed Context Injection)
Type \`@\` in the Studio input to open a searchable dropdown of all crystals and artifacts. Selected items are:
- Pinned as **chips** above the input field
- Their **full content** is injected directly into your message
- This guarantees the AI sees the complete entity content regardless of whether RAG would have retrieved it

Use @mentions when you need the AI to reference a specific entity that might not be automatically retrieved — for example, a character who is not mentioned by name in your recent messages.`,
        },
        {
            id: "obsidian",
            title: "Obsidian Compatibility",
            content: `## Obsidian Vault Support
Rhyolite is designed to work seamlessly with Obsidian vaults. Your \`.md\` files are readable and editable in both applications simultaneously.

---

## How It Works

### File Storage
- **Title-based filenames**: Crystals and artifacts are saved as \`Title.md\` (e.g., \`The Four Powers.md\`) rather than opaque IDs
- **ID in frontmatter**: Each file stores its internal Rhyolite ID in YAML frontmatter (\`---\\nid: abc123\\n---\`), keeping the file linkable within Rhyolite even if renamed externally
- **Immediate disk reflection**: All file operations (create, move, rename, delete) write directly to disk — changes are visible in Obsidian (and any file manager) immediately

### The \`.rhyolite/\` Directory
Project metadata is stored in a hidden \`.rhyolite/\` directory at the project root:
- **\`project.json\`**: Project configuration (name, Bedrock, Grain, timestamps)
- **Embeddings, indexes, and chat data**: Stored alongside project.json to keep the Obsidian vault root clean
- Obsidian ignores this directory by default since it starts with a dot

### Project Registry
Rhyolite maintains a **\`known-projects.json\`** file that tracks all registered project folders. When you open a folder, it is added to this registry for quick access in the project dropdown.

---

## Opening a Folder
In the project dropdown, select **Open Folder...** to open a native OS folder picker. Rhyolite will:

1. Register the folder in \`known-projects.json\`
2. Scan all subdirectories, creating matching folders in the sidebar
3. Index all \`.md\` files as crystals (documents)
4. Build the embedding index for semantic search

From this point, any file changes sync bidirectionally — edit in Rhyolite and see changes in Obsidian, or edit in Obsidian and see changes when Rhyolite refreshes.

---

## Wikilink Formats Supported
Rhyolite recognizes and renders four wikilink formats, all compatible with Obsidian:

| Format | Example | Behavior |
|--------|---------|----------|
| \`[[Title]]\` | \`[[The Dark One]]\` | Links to entity with matching title |
| \`[[Title\\|display]]\` | \`[[The Dark One\\|Malthus]]\` | Links to "The Dark One" but displays "Malthus" |
| \`[display](<Target>)\` | \`[Malthus](<The Dark One>)\` | Standard markdown link recognized as entity reference |
| \`[Title]\` | \`[The Dark One]\` | Bare bracket reference (also recognized) |

All formats render as clickable links in the preview pane. Clicking navigates to the referenced entity.

---

## Dead Link Resolution
The **Resolve [[links]]** button in the editor toolbar scans the active crystal for \`[[wikilinks]]\` that do not resolve to any existing artifact or document.

### Pipeline Process
1. Dead links are identified by scanning the document for all \`[[...]]\` patterns and checking against existing entity titles and aliases
2. A **3-stage chisel pipeline** runs for each dead link (or in batch):
   - **Researcher** chisel gathers relevant lore context from existing artifacts and the project's Bedrock
   - **Writer** chisel produces a fully-fleshed article for the missing entity, using the gathered context
   - **Auditor** chisel reviews the generated article for consistency and completeness
3. New artifacts are created with the generated content
4. Live streaming progress is shown in the editor toolbar

### Also Available as a Tool
The \`resolve_dead_links\` tool is available in Carve mode, allowing the AI to trigger dead link resolution programmatically during an agent session.`,
        },
        {
            id: "naming",
            title: "Naming Guide",
            content: `## Rhyolite Naming Conventions
The interface uses a **stone, geology, and crafting theme**. Every term maps to a familiar concept. Here is the complete reference:

| Term | Meaning |
|------|---------|
| **Crystal** | A document — chapter, scene, draft, or note |
| **Artifact** | A wiki entry — character, location, faction, lore page |
| **Vein** | A timeline / directed acyclic graph (DAG) |
| **Glyph** | An AI persona configuration (model + prompt + settings) |
| **Sculptor** | A top-level glyph shown in the Studio picker — your primary AI persona |
| **Chisel** | A specialist sub-agent glyph used for delegation and pipelines |
| **Studio** | The AI chat panel attached to each entity |
| **Bedrock** | Core canon / lore bible — immutable project context, always injected |
| **The Grain** | Story outline / narrative structure — always injected alongside Bedrock |
| **Quarry** | The global network graph view showing all entities and their connections |
| **Relief** | A DAG template / scaffold (e.g., Three-Act Structure, Character Arc) |
| **Facet** | One of the 3 parallel generation variants in The Polisher |
| **Polishing Wheel** | The free-text mixing editor in The Polisher |
| **Gem Tree** | The branching tree of all Polisher generations |
| **The Polisher** | The multi-generation text refinement tool |
| **Inspect** | Read-only Q&A mode — AI reads but cannot modify (formerly "Ask") |
| **Blueprint** | Plan-then-execute mode — AI proposes, you approve (formerly "Plan") |
| **Carve** | Full agent tool-use mode — AI can read and write everything (formerly "Agent") |
| **Write** | Automated 3-stage pipeline mode (researcher, writer, auditor) |
| **Research** | Custom pipeline mode using sculptor-configured chisel sequence |

---

## Why These Names?
The naming theme draws from the geological origin of **rhyolite** — a volcanic rock formed through intense pressure and creative force:

- **Crystals** are formed under pressure, polished, and can be cut or reshaped — like your prose through drafting and revision
- **Artifacts** are discovered objects with deep history — like your world's lore entries, each carrying backstory and significance
- **Veins** run through rock carrying minerals, connecting distant points — like your timeline graphs connecting events across your narrative
- **Glyphs** are carved symbols with layered meaning — like your AI persona configurations, each encoding personality and capability
- **Sculptors** shape the stone at the highest level — your primary AI personas directing the creative vision
- **Chisels** are the precision tools wielded by sculptors — your specialist sub-agents doing focused work
- **Studio** is the workshop where raw material becomes refined output — your AI chat interface
- **Bedrock** is the immovable geological foundation — your core canon that everything else rests upon
- **The Grain** is the natural direction of the stone, guiding where it splits — your narrative structure that guides the story's flow
- **Quarry** is the open pit where you see all the raw material at once — your global graph view of every entity and connection
- **Relief** is a raised pattern carved into stone — your DAG templates that give structure to timelines
- **Facets** are the flat faces of a cut gemstone — the multiple parallel variations generated by The Polisher
- **The Polishing Wheel** is where rough gems become brilliant — your free-text editor for mixing and refining generated text`,
        },
        {
            id: "features",
            title: "Additional Features",
            content: `## Reasoning Display
Toggle the **brain icon** in the Studio controls to enable extended thinking. When supported by the model and provider, this activates **provider-native reasoning** (e.g., Gemini's thinking, Claude's extended thinking). The AI's chain of thought is displayed in a **collapsible block** above the response — expand it to see how the AI reasoned through your request.

---

## @Mention Autocomplete
Type \`@\` in the Studio input to trigger a **searchable dropdown** of all crystals and artifacts in your project:
- Results filter as you type after the \`@\` character
- Click a result (or press Enter) to **pin** it as a chip above the input
- Multiple entities can be pinned simultaneously
- Each pinned entity's **full content** is injected into your message, guaranteeing the AI sees it regardless of automatic RAG retrieval

---

## File Attachments
Click the **paperclip button** in the Studio input area to open a file picker:
- Select any text file from disk
- The file's content is injected as context in your message
- Useful for providing reference material, style guides, or external notes

---

## Context Token Estimate
The **CTX** indicator in the Studio header provides a real-time estimate of total context size. **Hover** over it for a detailed breakdown showing: History, Artifacts, Veins, Draft, System + Bedrock, and Total character counts.

---

## Branch/Fork System
Studio supports **branching conversations** — a tree structure rather than a linear thread:
- Each user message can have **multiple AI responses** (siblings)
- Navigate between sibling responses using the **left/right arrow** controls on each message
- **Regenerate**: Click the regenerate button to generate a new sibling response from the same user message
- **Edit & Re-run**: Edit any user message to create a new fork — the edited message becomes a new branch with its own AI response
- **Delete**: Remove a message and all its descendants from the conversation tree
- **Copy**: Copy any AI response to clipboard as markdown text

---

## Error Handling
The system displays **inline error messages** for common failure scenarios:
- **Rate limits**: Shows the error and retry-after information from the provider
- **Auth errors**: Indicates an invalid or missing API key, prompting you to check configuration
- **Provider errors**: Displays the specific error details from the LLM provider (Gemini, OpenAI, Anthropic)

All errors appear inline in the chat stream — they do not crash the application or lose your conversation.

---

## Quarry (Global Network Graph)
The Quarry renders an interactive **force-directed graph** of all entities in your project:
- **Amber nodes**: Crystals (documents)
- **Cyan nodes**: Artifacts (wiki entries)
- **Purple nodes**: Timeline events
- **Edges**: Drawn from wikilinks, cross-references, tags, and timeline connections

Controls:
- **Zoom**: Continuous range from **0.05x to 4x** magnification
- **Fit**: Auto-fit button centers and scales to show all nodes
- **Auto-layout**: Force-directed positioning with physics simulation
- **MiniMap**: Small overview panel for navigation in large graphs
- **Click**: Click any node to navigate to that entity

---

## Editor Toolbar
The toolbar above the editor provides quick-insert buttons for common markdown:
- **Bold** (B), **Italic** (I), **Heading** (H), **List**, **Blockquote** (Quote), **Horizontal Rule** (HR)
- Each button inserts the appropriate markdown syntax at the current cursor position

---

## Entity Link Suggestions
The **bottom bar** of the editor automatically scans your text for mentions of artifact names and aliases. When a potential link is detected that is not yet wrapped in \`[[wikilinks]]\`:
- The suggestion appears as a clickable chip in the bottom bar
- Click it to automatically wrap the mention in \`[[wikilinks]]\` in your text
- Helps maintain consistent cross-referencing across your project

---

## Dead Link Indicators
In the **rendered preview** pane, any \`[[wikilink]]\` that does not resolve to an existing crystal or artifact is displayed with a **dashed red border**. This provides immediate visual feedback about broken references without leaving the editor.

---

## View Modes
The editor supports three view modes, toggled via buttons in the toolbar:
- **Split**: Markdown editor (left) + live rendered preview (right) — the default
- **Write**: Full-width markdown editor only — maximum writing space
- **Read**: Full-width rendered preview only — distraction-free reading

---

## Auto-Save
Every edit is automatically saved after a **400ms debounce**. A brief "Saving..." indicator appears in the toolbar during save. You never need to manually save — just write.

---

## Infill / Rewrite
Select text in the editor and a **floating toolbar** appears with a "Rewrite / Infill" option:
1. Click "Rewrite / Infill"
2. Type an instruction (e.g., "make this more dramatic", "expand this scene", "fix the dialogue")
3. A streaming preview replaces the selected text in real-time
4. The rewrite uses your project's lore bible, story outline, and wiki entries as context for coherent results

This is separate from The Polisher — Infill/Rewrite is a quick single-generation tool using the default model (Gemini Flash), while The Polisher offers multi-generation branching with a dedicated glyph.

---

## Relief Templates
Five built-in DAG templates are available via the **[ Relief ]** button on the canvas toolbar:
1. **Three-Act Structure**: Setup, confrontation, resolution with key narrative beats
2. **Character Arc**: From ordinary world through crisis to transformation
3. **Research Methodology**: Question formulation through literature review to conclusions
4. **Argument Chain**: Thesis, premises, evidence, counterarguments, synthesis
5. **Cause-Effect Analysis**: Inciting incident through cascading consequences

Applying a Relief populates the canvas with pre-connected nodes that you can then customize for your specific needs.`,
        },
        {
            id: "write",
            title: "Write Mode Pipeline",
            content: `## What Is Write Mode?
Write mode is an **automated 3-stage content generation pipeline** that coordinates three specialist chisel sub-agents to produce polished prose. Unlike Carve mode (where the AI decides what tools to use), Write mode follows a fixed researcher-writer-auditor pipeline, with each stage role-locked to appropriate tools.

---

## Setup Requirements
To use Write mode, you need **3 chisel glyphs** in your Glyph Registry, each with a specific chisel tag:

| Chisel Tag | Purpose | Required? |
|------------|---------|-----------|
| \`researcher\` | Gathers lore, context, and relevant material before writing | Yes |
| \`writer\` | Produces the actual prose and writes it to the document | Yes |
| \`auditor\` | Reviews the written content and fixes specific issues | Yes |

### Creating the Chisels
1. Go to the **Glyph Registry**
2. Create 3 new glyphs (or repurpose existing ones)
3. For each: **uncheck** "Sculptor (Show in Studio)" to make it a chisel
4. Set the **Chisel Tag** to \`researcher\`, \`writer\`, or \`auditor\` respectively
5. Configure each with an appropriate **system instruction** for its role:
   - Researcher: "You are a meticulous lore researcher. Search artifacts and timelines to gather all relevant context..."
   - Writer: "You are a skilled prose writer. Using the research context provided, produce engaging narrative prose..."
   - Auditor: "You are a careful editor and continuity checker. Review the written text for consistency, prose quality..."
6. Each chisel can use a **different model** — e.g., a fast model for research, a creative model for writing, a precise model for auditing

---

## How It Works Step by Step

### 1. You Send a Message
Select **Write** mode in the Studio mode picker, then type your request (e.g., "Write Chapter 3 where Elena discovers the hidden library").

### 2. Pipeline Auto-Discovery
The system scans the Glyph Registry for chisels tagged \`researcher\`, \`writer\`, and \`auditor\`. If any are missing, a status message tells you which tags need to be created.

### 3. Researcher Stage
The researcher chisel runs first with **read-only tools**:
- \`search_artifacts\`: Find relevant wiki entries
- \`read_artifact\`: Read specific lore pages
- \`read_draft\`: Read the current document content
- \`search_project\`: Search across all entity types
- \`read_timeline\`: Read vein graph data
- \`resolve_dead_links\`: Identify unresolved references

The researcher gathers all relevant lore, character details, timeline context, and existing prose. Its output becomes context for the writer.

### 4. Writer Stage
The writer chisel runs next with **draft-writing tools** (all researcher tools plus):
- \`write_draft\`: Overwrite the document with new content
- \`append_to_draft\`: Add text to the end
- \`replace_in_draft\`: Find and replace specific text spans
- \`create_document\`: Create new documents if needed

The writer receives the researcher's gathered context and produces prose. It should call \`write_draft\` **once** with the complete text to write to the document.

### 5. Auditor Stage
The auditor chisel runs last with **read + targeted fix tools** (researcher tools plus):
- \`replace_in_draft\`: Fix specific passages
- \`read_draft\`: Re-read the written content

The auditor reviews what the writer produced, checking for continuity errors, prose quality issues, and consistency with established lore. It applies targeted fixes via \`replace_in_draft\` rather than rewriting from scratch.

### 6. Sculptor Summary
After all three stages complete, the pipeline injects a summary directive to your main sculptor glyph. The sculptor produces a **brief 2-4 sentence summary** of what was written and any issues the auditor flagged. The sculptor does NOT repeat or paste the written content into chat — the prose is already in your document.

---

## Pipeline Progress UI
While the pipeline runs, the Studio displays:
- A **teal progress bar** showing overall pipeline advancement
- **Step indicators** showing which stage is currently active (e.g., "Step 2/3: Writer")
- **Expandable chisel cards** for each stage, showing the chisel's name, role, and streaming output
- Status messages for pipeline events (starting, completing, errors)

---

## Tips for Best Results

### Researcher Chisel
- Configure its system instruction to be thorough but focused
- It should search broadly for relevant context, not write prose
- Give it a fast model — research does not need high creativity

### Writer Chisel
- The writer should call \`write_draft\` **once** with the complete text
- Avoid having it make multiple small appends — one cohesive write is better
- Use a creative model with moderate-to-high temperature for engaging prose
- Its system instruction should emphasize narrative craft, voice, and style

### Auditor Chisel
- The auditor should only fix **specific issues**, not rewrite the entire document
- Use \`replace_in_draft\` for targeted corrections, not \`write_draft\` for full rewrites
- Configure it with a precise, detail-oriented system instruction
- A lower temperature works well for auditing — you want consistency, not creativity

### General
- Write mode works best when your Bedrock and Grain are well-populated — the pipeline relies on established lore
- Each chisel can use a different provider and model, allowing you to optimize cost and quality per stage
- The pipeline runs up to **12 iterations per chisel** (the inner loop limit), which is usually more than enough
- Risky tool actions from any chisel still require your manual confirmation`,
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
