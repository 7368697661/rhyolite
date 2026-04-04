"use client";

import { useState } from "react";

interface DocsModalProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    id: "concepts",
    title: "Workspace Concepts",
    content: `## Projects
A project is your top-level container for a creative work. Each project has:
- **Lore Bible**: Core canon and world rules that are ALWAYS included in AI context
- **Story Outline**: High-level narrative structure used as AI context

## Crystals (Documents)
Crystals are your primary writing documents — chapters, scenes, drafts. They live in the sidebar under your project and can be organized into folders.
- The center editor supports markdown with live preview
- When a crystal is selected, the AI chat automatically uses it as context
- Use folders to organize by act, section, or however you prefer

## Artifacts (Wiki Entries)
Artifacts are your project encyclopedia — characters, locations, factions, magic systems, items. They work like wiki pages.
- The AI automatically retrieves relevant artifacts when you mention them in chat
- Each artifact can have **aliases** (comma-separated) so the AI recognizes different names
- In **Agent mode**, the AI can create and edit artifacts directly
- Artifacts support keyword search AND semantic (meaning-based) search

## Timelines
Timelines are visual directed acyclic graphs (DAGs) for plotting your story.
- **Nodes** represent events, scenes, or plot points
- **Edges** represent causality, sequence, or relationships between events
- Nodes can be tagged with artifact references for cross-linking
- Nodes can reference a crystal document for deeper content

## Chats (Comms)
Each crystal, artifact, or timeline gets its own AI chat session attached to a "glyph" (AI persona).`,
  },
  {
    id: "modes",
    title: "Chat Modes",
    content: `## Ask Mode
Default mode. Single-turn Q&A with RAG (retrieval-augmented generation).
- The AI reads your current crystal, relevant artifacts, timeline context, lore bible, and story outline
- Great for brainstorming, getting feedback, asking "what if" questions
- No tools — the AI can only read, not modify your project

## Agent Mode
Full tool-using AI mode. The AI can search, read, create, update, and delete project entities.
- **17 tools** across artifacts, timelines, documents, search, link resolution, and sub-agent delegation
- **Risky actions** (delete operations, large rewrites) require your approval via an inline confirmation prompt
- Multi-turn: the AI can chain multiple tool calls in a single response
- Safety cap of 20 tool iterations per message (8 per specialist inner loop) to prevent runaway loops
- After agent actions, the sidebar automatically refreshes

### Available Tools
| Tool | Risk | Description |
|------|------|-------------|
| search_artifacts | Safe | Token-based keyword + embedding RAG search across wiki entries and documents |
| read_artifact | Safe | Read full content of a wiki entry |
| create_artifact | Normal | Create a new wiki entry |
| update_artifact | Normal | Edit an existing wiki entry |
| delete_artifact | **Risky** | Permanently delete a wiki entry |
| read_timeline | Safe | Read timeline graph (nodes + edges) |
| create_timeline_node | Normal | Add event node to timeline |
| update_timeline_node | Normal | Edit a timeline node |
| delete_timeline_node | **Risky** | Delete node + connected edges |
| create_edge | Normal | Connect two timeline nodes (auto-layouts DAG) |
| auto_layout_dag | Safe | Reposition all nodes using layered DAG layout |
| delete_edge | **Risky** | Remove a connection |
| read_draft | Safe | Read current document content |
| append_to_draft | Normal | Append text to active document |
| search_project | Safe | Token-based keyword + embedding RAG search across all entities |
| resolve_dead_links | Normal | Find dead [[wikilinks]] in a document and create stub artifacts |
| delegate_to_specialist | Normal | Delegate a task to a specialist sub-agent glyph |
| delegate_fan_out | Normal | Run multiple specialist sub-agents in parallel |

## Plan Mode
Propose-then-execute mode. The AI creates a structured plan of tool calls for your review.
- The AI outputs a checklist of proposed actions with rationale for each
- You can approve/reject individual steps
- Click "Execute" to run the approved steps sequentially
- All steps get confirmation UI regardless of risk level (that's the point of plan mode)
- Great for complex operations where you want full control`,
  },
  {
    id: "glyphs",
    title: "Glyphs (AI Personas)",
    content: `## What are Glyphs?
Glyphs are configurable AI personas that control the behavior of your chat sessions. Each glyph has:
- **Name**: Display name for the persona
- **System Instruction**: The base prompt that shapes the AI's personality and capabilities
- **Model**: Which AI model to use (Gemini, GPT-4, Claude, etc.)
- **Provider**: Which LLM provider to use (Gemini, OpenAI-compatible, Anthropic)
- **Temperature**: Controls creativity/randomness (0 = focused, 1 = creative)
- **Max Output Tokens**: Maximum response length
- **Sculpter toggle**: Whether this glyph appears in the comms picker
- **Specialist Role**: Optional role tag for specialist glyphs (e.g. "researcher", "continuity")

## Sculpters vs Specialists
- **Sculpters** are the entry-point glyphs shown in the comms glyph picker. They run top-level chat sessions and can delegate work to specialists.
- **Specialists** are sub-agent templates that do NOT appear in the picker. They are invoked via the delegate_to_specialist or delegate_fan_out tools during an Agent mode session.
- Existing glyphs without these fields default to Sculpter (backward-compatible).

## How Delegation Works
In Agent mode, a Sculpter can call delegate_to_specialist with a specialist glyph ID and a task description. The system runs a nested agent loop using the specialist's provider, model, system instruction, and config. The specialist can use all standard tools (but cannot delegate further). Results are returned to the Sculpter as a tool result.

For parallel delegation, the Sculpter can call delegate_fan_out with multiple specialist/task pairs. All run concurrently and results are collected.

### Limits
- **Outer loop (Sculpter)**: 20 iterations max
- **Inner loop (each Specialist)**: 8 iterations max
- Risky actions by specialists still require user confirmation

## Example Specialist Roles
- **Researcher**: Deep-dives into artifacts and timelines for context gathering
- **Continuity**: Checks existing lore and flags inconsistencies
- **Timeline**: Manages DAG structures and event creation
- **Editor**: Reviews and polishes crystal drafts

## Creating Glyphs
Navigate to the Glyph Registry page to create custom personas. Uncheck "Sculpter (show in comms)" to make a glyph a specialist template.`,
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

## Chat
| Shortcut | Action |
|----------|--------|
| \`Enter\` | Send message |
| \`Shift+Enter\` | New line in message |

## Editor
| Shortcut | Action |
|----------|--------|
| Standard text editing shortcuts | Supported in the markdown editor |

## Command Palette
| Action | Description |
|--------|-------------|
| Search | Find any crystal, artifact, or timeline by name |
| Navigate | Jump to any entity across your project |`,
  },
  {
    id: "obsidian",
    title: "Obsidian Compatibility",
    content: `## Obsidian Vault Support
Rhyolite can use an Obsidian vault as its project directory. Your .md files are readable and editable in both apps.

## How It Works
- **Title-based filenames**: Crystals and artifacts are saved as \`Title.md\` (e.g. \`The Four Powers.md\`) instead of random IDs
- **ID in frontmatter**: Each file stores its internal Rhyolite ID in YAML frontmatter, keeping the file linkable even if renamed. If no ID exists, it uses the filename.
- **\`[[Wikilinks]]\`**: Double-bracket links (\`[[Character Name]]\` or \`[[Title|display text]]\`) and standard markdown links (\`[Display](<Target>)\`) are recognized as entity references and rendered as clickable links
- **Metadata in \`.rhyolite/\`**: Project config lives in \`.rhyolite/project.json\`, keeping Obsidian's root clean

## Open Folder
In the project dropdown, select **Open Folder...** to open a native OS folder picker. Rhyolite will:
- Register the folder natively via \`known-projects.json\` (no symlinks used)
- Scan subdirectories directly, creating matching Folders in the Rhyolite sidebar
- Operations like moving files or renaming folders reflect immediately on the disk

## Templates Support (\`_templates/\`)
Rhyolite automatically detects templates in the \`_templates/\` directory (a common Obsidian convention).
- **DAG Canvas**: When auto-synthesizing a node, select an available template from a dropdown to structure the AI's output.
- **Dead Link Resolver**: Uses \`Wiki_Page_Template.md\` by default to ensure generated artifacts match your project style.

## Dead Link Resolver
The **Resolve [[links]]** button in the document editor scans the active crystal for \`[[wikilinks]]\` that don't point to any existing artifact or document.
- It runs a **3-stage specialist AI pipeline** (Researcher → Writer → Auditor) with live streaming progress
- Creates fully-fleshed, template-compliant articles using RAG context
- Configure the \`researcher\`, \`writer\`, and \`auditor\` specialist glyphs to tune behavior
- Also available as the \`resolve_dead_links\` agent tool in Agent mode

## Coexistence Rules
- **Markdown files** map 1:1 with crystals/artifacts. Deleting in one app deletes in the other.
- **JSON files** (timelines, chats, glyphs) stay as JSON — they're structured data, not prose
- **Obsidian plugins and settings** (\`.obsidian/\` folder) are untouched`,
  },
  {
    id: "features",
    title: "Additional Features",
    content: `## Reasoning Display
Toggle "Reasoning: ON" in the chat header to see the AI's thinking process (when supported by the model). This uses provider-native reasoning features and shows the AI's chain of thought in a collapsible block.

## Safety Presets
Control content filtering with the Safety dropdown:
- **BLOCK_NONE**: No content filtering (default for creative writing)
- **Low**: Block only extreme content
- **Medium**: Moderate content filtering
- **High**: Strict content filtering

## Prompt Templates
Save frequently-used prompts as templates:
1. Type your prompt in the chat input
2. Click the \`/\` button
3. Click "[+] Save current as template"
4. Name your template
5. Templates persist per-project

## File Attachments
Attach images and text files to chat messages:
- Drag and drop or use the paperclip button
- Supported: images (any format), text files (.txt, .md, .csv, .json)
- Images are sent as inline data to vision-capable models
- Text files are included as context in the message

## Token Budget Display
Hover over the "CTX" indicator in the chat header to see a breakdown of how your context window is being used (canon, wiki, DAG, draft, history).

## Branch/Fork System
Chat supports branching conversations:
- Each user message can have multiple AI responses
- Navigate between branches using the ← / → controls
- Regenerate responses to explore different AI outputs
- Edit or delete messages in the conversation tree

## Error Handling
The system displays inline warnings for:
- **Rate limits**: Shows retry countdown
- **Auth errors**: Prompts to check API key
- **Provider errors**: Shows error details`,
  },
] as const;

export default function DocsModal({ open, onClose }: DocsModalProps) {
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  if (!open) return null;

  const section = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex h-[80vh] w-[90vw] max-w-4xl flex-col border border-violet-600/60 bg-[#020005] shadow-2xl shadow-violet-900/20">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-violet-600/40 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-violet-500 font-mono text-xs">&gt;_</span>
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400">
              Documentation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-violet-800/60 bg-black px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-400 hover:border-violet-600 hover:text-violet-200"
          >
            ESC
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <nav className="flex w-48 shrink-0 flex-col border-r border-violet-800/40 bg-black/50 py-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={`px-4 py-2 text-left text-[10px] font-mono uppercase tracking-wider ${
                  activeSection === s.id
                    ? "bg-violet-900/30 text-violet-200 border-l-2 border-violet-400"
                    : "text-violet-600 hover:text-violet-400 hover:bg-violet-950/30 border-l-2 border-transparent"
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="prose prose-invert prose-violet max-w-none text-xs leading-relaxed [&_h2]:text-violet-300 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-violet-400 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:text-violet-300/90 [&_p]:mb-3 [&_strong]:text-violet-200 [&_li]:text-violet-300/90 [&_ul]:mb-3 [&_table]:text-[10px] [&_th]:text-violet-400 [&_th]:border-violet-800/60 [&_td]:border-violet-800/40 [&_td]:text-violet-300 [&_code]:text-violet-400 [&_code]:bg-violet-950/40 [&_code]:px-1 [&_code]:text-[10px]">
              <MarkdownContent content={section.content} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  // Simple markdown-to-JSX renderer for the docs
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  function flushTable() {
    if (tableLines.length < 2) return;
    const headers = tableLines[0]
      .split("|")
      .map((h) => h.trim())
      .filter(Boolean);
    const rows = tableLines.slice(2).map((r) =>
      r
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
    );
    elements.push(
      <table key={elements.length} className="w-full border-collapse mb-4">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="border border-violet-800/60 px-2 py-1 text-left font-bold uppercase"
              >
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-violet-800/40 px-2 py-1">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
    tableLines = [];
  }

  function renderInline(text: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(
          <strong key={match.index} className="text-violet-200">
            {match[2]}
          </strong>
        );
      } else if (match[3]) {
        parts.push(
          <code key={match.index} className="text-violet-400 bg-violet-950/40 px-1 text-[10px]">
            {match[3]}
          </code>
        );
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }

  let listItems: React.ReactNode[] = [];

  function flushList() {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={elements.length} className="list-disc pl-4 mb-3 space-y-1">
        {listItems}
      </ul>
    );
    listItems = [];
  }

  for (const line of lines) {
    if (line.startsWith("|") && line.includes("|")) {
      flushList();
      if (!inTable) inTable = true;
      tableLines.push(line);
      continue;
    }

    if (inTable) {
      inTable = false;
      flushTable();
    }

    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={elements.length}>{renderInline(line.slice(3))}</h2>
      );
    } else if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={elements.length}>{renderInline(line.slice(4))}</h3>
      );
    } else if (line.startsWith("- ")) {
      listItems.push(
        <li key={`li-${elements.length}-${listItems.length}`}>{renderInline(line.slice(2))}</li>
      );
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={elements.length}>{renderInline(line)}</p>
      );
    }
  }

  flushList();
  if (inTable) flushTable();

  return <>{elements}</>;
}
