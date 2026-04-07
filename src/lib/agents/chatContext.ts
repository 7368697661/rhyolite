import { retrieveSimilar } from "./embeddings";
import { resolveChatProjectContext, buildTimelineDagRagFragment } from "./timelineDagContext";
import { windowDraftContent } from "./draftWindowing";
import type { FsChatMessage } from "./fs-db";

export interface ChatContextParams {
  projectId: string;
  documentId?: string | null;
  timelineId?: string | null;
  activeTimelineEventId?: string | null;
  cursorPosition?: number | null;
  chainToRootList: FsChatMessage[];
}

export interface ChatContextResult {
  systemInstructionAdditions: string;
  ragContextText: string;
  stats: {
    wikiChars: number;
    dagChars: number;
    draftChars: number;
  };
}

export async function assembleContext(params: ChatContextParams): Promise<ChatContextResult> {
  const { projectId, documentId, timelineId, activeTimelineEventId, cursorPosition, chainToRootList } = params;

  let systemInstructionAdditions = "";
  let ragContextText = "";
  let wikiChars = 0;
  let dagChars = 0;
  let draftChars = 0;

  const { project, document } = await resolveChatProjectContext({
    projectId,
    documentId,
    timelineId,
  });

  if (project) {
    // Project might have loreBible and storyOutline added in the future
    const p = project as any; 

    if (p.loreBible || p.lore_bible) {
      systemInstructionAdditions += `\n\n---\nBEDROCK / CORE CANON (ALWAYS ON):\n${p.loreBible || p.lore_bible}`;
    }
    if (p.storyOutline || p.story_outline) {
      systemInstructionAdditions += `\n\n---\nTHE GRAIN (STORY OUTLINE):\n${p.storyOutline || p.story_outline}`;
    }

    if (activeTimelineEventId) {
      const dagFragment = await buildTimelineDagRagFragment(activeTimelineEventId);
      dagChars = dagFragment.length;
      ragContextText += dagFragment;
    }

    const recentUserText = chainToRootList
      .slice(-3)
      .map((m) => m.content)
      .join("\n")
      .toLowerCase();
    const draftText = document?.content
      ? document.content.slice(-4000).toLowerCase()
      : "";
    const searchCorpus = recentUserText + "\n" + draftText;

    const keywordMatched = new Set<string>();
    const matchedWikis = project.wikiEntries.filter((w) => {
      const title = w.title.toLowerCase();
      const aliases = (w.aliases || "")
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Full-title match
      if (searchCorpus.includes(title)) { keywordMatched.add(w.id); return true; }
      // Individual word match (words >= 3 chars to avoid noise)
      const titleWords = title.split(/\s+/).filter((word) => word.length >= 3);
      for (const word of titleWords) {
        if (searchCorpus.includes(word)) { keywordMatched.add(w.id); return true; }
      }
      // Alias full match and word match
      for (const a of aliases) {
        if (searchCorpus.includes(a)) { keywordMatched.add(w.id); return true; }
        const aliasWords = a.split(/\s+/).filter((word) => word.length >= 3);
        for (const word of aliasWords) {
          if (searchCorpus.includes(word)) { keywordMatched.add(w.id); return true; }
        }
      }
      return false;
    });

    const timelineEventHits: Array<{ id: string; title: string; score: number }> = [];
    try {
      const embeddingQuery = chainToRootList.slice(-2).map((m) => m.content).join("\n");
      if (embeddingQuery.trim().length > 0) {
          const similar = await retrieveSimilar(projectId, embeddingQuery, 8);
          for (const hit of similar) {
            if (hit.type === "wiki" && !keywordMatched.has(hit.id)) {
              const entry = project.wikiEntries.find((w) => w.id === hit.id);
              if (entry) matchedWikis.push(entry);
            } else if (hit.type === "timeline_event") {
              timelineEventHits.push(hit);
            }
          }
      }
    } catch { /* embedding retrieval is optional */ }

    if (matchedWikis.length > 0) {
      const wikiStart = ragContextText.length;
      ragContextText += `[RETRIEVED WIKI ENTRIES (For Context)]\n`;
      for (const entry of matchedWikis) {
        ragContextText += `### ${entry.title}\n${entry.content}\n\n`;
      }
      wikiChars = ragContextText.length - wikiStart;
    }

    if (timelineEventHits.length > 0) {
      ragContextText += `[RELATED VEIN EVENTS]\n`;
      for (const hit of timelineEventHits) {
        ragContextText += `- ${hit.title} (score: ${hit.score.toFixed(2)})\n`;
      }
      ragContextText += `\n`;
    }

    if (document?.content) {
      const { text: windowedDraft, isWindowed } = windowDraftContent(
        document.content,
        cursorPosition ?? undefined
      );
      const label = isWindowed
        ? `\n[CURRENT CHAPTER DRAFT (windowed — cursor region highlighted)]\n`
        : `\n[CURRENT CHAPTER DRAFT]\n`;
      const draftSection = `${label}${windowedDraft}\n\n(Note: The above is the current state of the chapter. Do not repeat it verbatim unless rewriting. Use it to inform your continuation.)\n`;
      draftChars = draftSection.length;
      ragContextText += draftSection;
    }
  }

  return {
    systemInstructionAdditions,
    ragContextText,
    stats: {
      wikiChars,
      dagChars,
      draftChars
    }
  };
}
