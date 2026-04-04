# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-04-03

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