# Rhyolite - AI Writing IDE

Rhyolite is a next-generation AI writing environment, blending a markdown-based text editor with an integrated AI chat assistant powered by Google Gemini. It is designed specifically for authors, novelists, and long-form writers who want to collaborate seamlessly with AI without leaving their document.

## Features

- **3-Pane AI Writing IDE:**
  - **Project Sidebar:** Manage multiple writing projects, each containing its own chapters (Documents) and Lore Bible (Wiki Entries).
  - **Document Editor:** A distraction-free markdown text editor where you write your chapters. Includes word count, back/forward history navigation, and inline Wiki link rendering.
  - **Chat Assistant:** An integrated, per-chapter AI assistant pane (full-width transcript with horizontal separators, not chat bubbles) that brainstorms, critiques, and writes alongside you.
- **RAG-less Continuity (Omni-Context):** Instead of complex vector search, Rhyolite leverages Gemini's massive context window. Every time you send a message, the system automatically injects the project's **Chapter outline** and **Story / Lore bible** (from Project Settings), then all wiki entries, then the *current chapter's draft*. The AI always knows your planned arc, world rules, and what's on the page.
- **Infill & Rewrite:** Highlight any text in the Document Editor and hit the ✨ Infill/Rewrite button. Instruct the AI to "expand this," "make it more descriptive," or "rewrite in first person," and watch the prose get replaced dynamically in your editor.
- **Actionable AI Responses:** 
  - **Append to Doc:** Quickly append any generated text from the chat directly into your chapter with one click.
  - **Extract to Wiki:** Highlight text directly in the Document Editor and hit the 📖 Extract to Wiki button to instantly save lore to your Lore Bible.
- **Lore Bible & Wiki Links:** Create wiki entries for characters, locations, and rules. Type `[[Character Name]]` in your chapter to create an inline clickable link that instantly navigates to that wiki entry in the editor pane.
- **Message Branching:** Chats support tree-based message branching. If you regenerate a response or scroll back to an old message and reply differently, it creates a new timeline branch without deleting the old ones. Navigate sibling responses with arrow controls.
- **Granular Safety Controls:** A dedicated UI dropdown to override Google's safety settings per-message, defaulting to `BLOCK_NONE` for unrestricted creative writing.

## Setup & Run Instructions

### Prerequisites
- Node.js (v18+ recommended)
- A Google Gemini API Key

### Installation

1. Clone or download the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables. Create a `.env` file in the root directory based on `.env.example`:
   ```bash
   DATABASE_URL="file:./dev.db"
   GEMINI_API_KEY="your-gemini-api-key-here"
   ```
4. Run the database migrations to set up the SQLite database:
   ```bash
   npx prisma migrate dev
   ```
5. Start the development server:
   ```bash
   npm run dev
   ```
6. Open your browser and navigate to `http://localhost:3000`.

## Architecture & Tech Stack

- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS (Dark macOS-inspired "Liquid Glass" theme with animated organic background)
- **Database:** SQLite via Prisma ORM (`@prisma/adapter-libsql`)
- **AI Integration:** `@google/genai` SDK using `gemini-3.1-pro-preview` with streaming support.
- **Markdown Rendering:** `react-markdown` & `remark-gfm`

## Usage Workflow

1. **Create a Project:** In the left sidebar, click `+ New Project`.
2. **Add a Chapter:** Under your new project, hover over "Chapters" and click `+ Add` to create your first document. You can rename documents by hovering over them and clicking the pencil icon.
3. **Build your Lore Bible:** Hover over "Lore Wiki" and click `+ Add` to start documenting your world.
4. **Project Settings:** Click "Project Settings" at the bottom of the sidebar. Edit **Chapter outline** and **Story / Lore bible**; changes save when you leave each field (blur). Both are included in chat, infill, and regenerate prompts alongside your wiki.
5. **Chat & Write:** With a chapter selected, select a Glyph (AI Persona) in the Right Pane to start a Chat Assistant session.
6. **Infill & Extract:** Highlight text in the middle pane, and use the floating buttons to either Extract it to your Wiki or Rewrite/Infill it with the AI.
7. **Cross-reference:** Type `[[Your Wiki Title]]` in the editor to link to your lore. Click it to navigate to the entry, and use the back arrow in the header to return to your chapter.
