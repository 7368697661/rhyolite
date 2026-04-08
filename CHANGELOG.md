# Changelog

All notable changes to this project will be documented in this file.

## [v0.4.0] - 2026-04-07 (SvelteKit + Tauri Desktop)

### Added
- **Desktop stack**: SvelteKit 2, Svelte 5 (runes), Vite 6, and **Tauri 2** with a **Rust** backend (`src-tauri/`) for filesystem I/O, project scanning, timelines, embeddings/RAG helpers, and secure local operations via `invoke`.
- **UI layer**: New Svelte components for sidebar, editor (markdown + live preview), Studio chat, command palette (`⌘K`), DAG canvas (`@xyflow/svelte` + Dagre layout), node editor, glyphs registry, project settings, top bar, Quarry (global network graph), and in-app docs modal (`[ Docs ]` in the top bar + global `showDocs` state).
- **Agent & LLM (TypeScript)**: Agent loop, tool catalog, multi-provider support (`@google/genai` + OpenAI-compatible + Anthropic patterns), chat branching, plan/blueprint execution, chisel delegation (`delegate_to_specialist`, `delegate_fan_out`), streaming tool/subagent UI, live context token estimate with hover breakdown, `@` mention autocomplete for crystals/artifacts, and file attachments via Tauri dialog/fs plugins.
- **README**: Full rewrite—approachable user guide (glossary, modes, use cases), deep technical section (architecture, 5-pillar RAG, agent loop, delegation, ER model) with detailed Mermaid diagrams, install prerequisites (Node + Rust), `npm run tauri dev`, environment variables, and font credits. GitHub / license badges updated for Svelte, Tauri, and Rust.

### Changed
- **Persistence model**: Project data remains Markdown + JSON on disk (Obsidian-friendly); reads/writes go through Tauri commands instead of Next.js API routes (removed `src/app/api/**`).
- **Terminology in UI**: Studio modes aligned with the stone theme where applicable (e.g. Inspect / Carve / Blueprint naming in docs and product copy).
- **Fonts**: `assistant.woff2` and `nightingale.woff2` served from `static/fonts/` for the Svelte app.

### Fixed / Hardened
- **DAG / timeline canvas**: Inline prompts replace browser `prompt()` (Tauri-safe); `bind:nodes` / `bind:edges` for correct xyflow interaction; network map reload split from timeline effects to stop flicker; agent tool runs trigger `reloadProjectData()` so canvas/sidebar stay in sync.
- **RAG & context**: More resilient wiki keyword matching (titles, aliases, word tokens); chat project context fallback when a bound doc/timeline is missing; `projectId` passed on document/wiki `invoke` writes so resolves and saves land in the correct project folder.
- **Editor**: Direct `resolve_dead_links` tool invocation with progress UI; callout cards, entity link chips, dead-link dashed styling; breadcrumbs; editor caret/block styling; various preview and accessibility fixes.
- **Repository hygiene**: `.gitignore` extended for `.cursor/plans/`, `.next/`, `.workspace/`, `dev.db`, `*.tsbuildinfo`, `generated/`, `rhyolite-reference/`, and duplicate `tailwind.config 2.js`. `.env` remains ignored with `!.env.example` / `!.env.test`.

### Removed
- **Next.js 15 / React 19** app router, React components under `src/app/**` and `src/components/**`, and all associated API route handlers.
- **Prisma** and prior server-only Node persistence paths tied to the old stack.

## [v0.3.0] - 2026-04-03 (Obsidian Parity & Sub-Agents)
### Added
- **Enhanced Dead Link Resolver**: Upgraded the link resolution system to use a 3-stage agent pipeline (Researcher → Writer → Auditor). Automatically generates fully fleshed-out articles instead of simple stubs. Features live streaming progress bars in the UI.
- **Template Support (`_templates/`)**: Natively supports Obsidian-style `_templates/` directories. The Dead Link Resolver automatically prioritizes `Wiki_Page_Template.md` for generated content. DAG auto-synthesis allows template selection via dropdown.
- **Specialist Glyphs**: Added support for defining Specialist Glyphs in `glyphs.json` via the UI. These are sub-agent templates (e.g., `researcher`, `writer`, `auditor`) that the dead link resolver and outer sculpter agents can delegate to.
- **Native OS Folder Picker**: "Open Folder" now opens a native OS folder picker via `osascript`/`zenity`/`PowerShell` depending on your platform.
- **Extended Auto-links**: Expanded link recognition to support markdown-style links `[Display](<Target>)` in addition to standard `[[Wikilinks]]`.

### Changed
- **Filesystem Mapping**: Symlinks are completely removed. Rhyolite now tracks external project directories using a `known-projects.json` registry.
- **Folders Parity**: Rhyolite's internal folder structure is now 1:1 derived directly from the filesystem directories instead of a JSON metadata map. Moving files or renaming folders immediately reflects on the disk.
- **File Parsing**: Better backward/forward compatibility with Obsidian. Files lacking a Rhyolite `id` in their frontmatter now safely fall back to using their filename stem as the ID.

### Fixed
- Fixed an issue with `EADDRINUSE` port 3000 conflicts when spawning the dev server.
- Fixed a bug where files missing frontmatter IDs would be ignored by the file scanner.
- Various UI layout bugs and TypeErrors in `agentTools.ts` and `DocumentEditorPane.tsx`.

## [v0.2.0] - 2026-03-30 (RHYOLITE// UI Polish & Documentation)
### Added
- Official renaming to RHYOLITE//.
- Comprehensive `README.md` documentation including architectural diagrams, Mermaid charts, shields, logo, fonts, and a Features at a Glance section.
- Added `BSL 1.1` License with clarifications on Production Purpose and additional use grants for personal creative work.

### Changed
- Unified markdown rendering across the app using shared `markdownComponents`.
- Token budget tooltip is now positioned dependably and clearly shows context usage.
- Replaced all legacy browser `prompt()` and `confirm()` dialogues with bespoke inline terminal forms.
- Normalized "Crystal" and "Artifact" terminology throughout the UI.
- Standardized API errors to strict JSON and sanitized all file paths.

### Fixed
- Fixed branch navigation bugs, history stale indexes, and chat race conditions.
- Fixed `CommandPalette` index bounds, keyboard a11y, focus trapping, and ARIA dialog roles.
- Fixed "fewer hooks" React crash on timeline open.
- Resolved referenced artifact/document content in DAG context builder (dragged-in nodes now correctly inject lore text to the LLM).
- Removed legacy Prisma/SQLite configuration, dead code, unused keyframes, and disabled CRT vignette overlays for better legibility.

## [v0.1.0-alpha.1] - 2026-03-30 (Rhyolite_OS Core)
### Added
- **Core Architecture**: Released the initial Terminal-aesthetic creative + research OS.
- **3-Pane UI**: Distinct UplinkOS-inspired layout for sidebar, editor, and comms.
- **DAG Timeline Canvas**: Integrated `reactflow` with semantic edges, categorical nodes, and auto-synthesis features.
- **Hybrid RAG Context Engine**: Blends keyword searching, embedding vectors (`text-embedding-004`), 10-hop BFS graph traversal, and smart context windowing.
- **Multi-Model LLM Streaming**: Native integrations for Gemini, OpenAI-compatible APIs, and Anthropic Claude.
- **Global Network Map**: Physics-driven `d3-force` + `reactflow` map with content-based link detection and interactive preview drawer.
- **Local-First Persistence**: All data stored as human-readable Markdown and structured JSON — completely database-free.
- **Productivity Features**: Full-text search (`⌘K`), inline version history, entity link hover previews, saved prompt templates, manuscript export, keyboard shortcuts, and indexed O(1) entity lookups.

## [Prototype] - 2026-03-26 (Initial Concepts)
### Added
- Initial proof-of-concept for the writing IDE.
- Added foundational Next.js architecture with project, document, and wiki workflows.
- Implemented HTML5 drag and drop for folder structures.
- Explored early styling with the ultraviolet cyberpunk scanline UI.