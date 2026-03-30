# Changelog

All notable changes to Rhyolite// are documented here.

---

## [0.2.0] — 2026-03-30

### Renamed

- Project identity: `RHYOLITE_OS` → `RHYOLITE//` across UI, metadata, and license.

### Added

- **Branch navigation (PUT handler):** Chat forward/back through generation forks now persists correctly (`PUT /api/chats/:id`).
- **Cursor-aware smart windowing:** Editor cursor position is wired through to the chat API; large documents send the chunk around the cursor instead of truncated head/tail.
- **Inline terminal forms:** All `window.prompt()` and `window.confirm()` calls replaced with `TerminalPrompt` and `TerminalConfirm` components matching the terminal aesthetic.
- **Shared markdown styles:** Extracted `markdownComponents.tsx` — ChatThread and WikiMarkdown now render with identical typography.
- **Token budget tooltip:** Hover the `CTX` indicator in comms to see a vertical CANON / WIKI / DAG / DRAFT / HIST / TOTAL breakdown. Uses fixed positioning so it never clips.
- **Entity suggestion strip v2:** Each suggestion now has a navigate button (opens the entity) and a `[+]` button (inserts link brackets).
- **Keyboard accessibility:** All hover-only sidebar buttons are now reachable via Tab (`focus-within:opacity-100`). Entity link previews show on focus.
- **Focus trap:** CommandPalette traps Tab/Shift+Tab so keyboard focus stays inside the dialog.
- **Timeline edge validation:** Creating an edge now validates that both source and target nodes exist in the timeline before writing.
- **Path traversal guard:** History API filename parameter sanitized with `path.basename()`.
- **`animate-fade-in` utility:** Custom Tailwind keyframe replaces the `tailwindcss-animate` dependency.
- **README badges:** GitHub, license, Next.js, React, TypeScript, Tailwind, storage type.
- **CHANGELOG.md** (this file).

### Fixed

- **CommandPalette selectedIndex** no longer goes negative when results are empty.
- **`isSaving` indicator** no longer gets stuck if a save request fails (try/finally in DocumentEditorPane and ProjectSettingsPane).
- **React.memo on MessageRow** now works: `renderForkControls`, `handleRegenerate`, and `handleMessagesMutated` wrapped in `useCallback`.
- **Chat race condition:** Sequence counter prevents stale fetch responses from overwriting current state.
- **History navigation:** `navigateTo` reads `historyIndexRef` instead of a stale closure.
- **Entity suggest console spam:** Changed from GET (entire document content in URL) to POST with JSON body.
- **Project DELETE:** Now surfaces `fs.rm` errors instead of returning a silent 204.
- **API error responses:** All routes standardized to `{ error: string }` JSON format.
- **`req.json()` parsing:** Chat, regenerate, and prompts routes catch malformed JSON with a 400.

### Changed

- **Terminology normalized:** "Crystal" for documents, "Artifact" for wiki entries — consistent across all UI strings, badges, and prompts.
- **CRT vignette overlay** disabled (edge darkening was too heavy).
- **README** fully rewritten: architecture diagram, technical tables, shields, cleaner section grouping.

### Performance

- **WikiMarkdown:** `processedContent` regex chain wrapped in `useMemo`.
- **DAG context:** Eliminated redundant `findProjectIdForNode` full scan; `getFullTimelineGraph` now returns `projectId` directly.
- **Sidebar filters:** Documents and wiki entries pre-grouped into `Map` by folderId via `useMemo` (replaces per-folder inline `.filter()`).
- **StatusClock:** Extracted into its own component so the 1-second tick doesn't re-render the entire workspace.
- **`tailwindcss-animate` removed:** Replaced with a single custom `fadeIn` keyframe to avoid an external dependency.

### Removed

- Legacy Prisma/SQLite files: `prisma.ts`, `chatBackfill.ts`, `prisma.config.ts`, `prisma/` schema and migrations, `scripts/migrate_timelines.ts`.
- Unused Tailwind keyframes: `scanline`, `glitch`, `blink`, `cpu`.
- Dead export `subtreeDeleteOrder` from `messageSubtree.ts`.
- Unused `readProject` import from `timelineDagContext.ts`.
- Debug `console.log` from hotkey handler.

---

## [0.1.0-alpha.1] — 2026-03-30

Initial tagged release. Core systems: terminal UI, DAG timeline canvas, hybrid RAG (keyword + embedding + graph traversal), multi-provider LLM streaming, filesystem persistence, global network map, full-text search, version history, entity extraction, manuscript export.
