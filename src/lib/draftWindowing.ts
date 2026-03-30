/**
 * Smart context windowing for large document drafts.
 * Extracts three windows (opening, cursor region, ending) to stay
 * within a reasonable token budget while preserving narrative context.
 */
export function windowDraftContent(
  content: string,
  cursorPosition?: number
): { text: string; isWindowed: boolean } {
  const words = content.split(/\s+/).filter(Boolean);

  if (words.length < 2000) {
    return { text: content, isWindowed: false };
  }

  const aEnd = 500;
  const cStart = words.length - 500;

  let cursorWordIdx: number;
  if (cursorPosition != null && cursorPosition >= 0) {
    let chars = 0;
    cursorWordIdx = words.length - 1;
    for (let i = 0; i < words.length; i++) {
      chars += words[i].length + 1;
      if (chars >= cursorPosition) {
        cursorWordIdx = i;
        break;
      }
    }
  } else {
    cursorWordIdx = words.length - 1;
  }

  let bStart = Math.max(aEnd, cursorWordIdx - 750);
  let bEnd = bStart + 1500;
  if (bEnd > cStart) {
    bEnd = cStart;
    bStart = Math.max(aEnd, bEnd - 1500);
  }

  const windowA = words.slice(0, aEnd).join(" ");
  const windowC = words.slice(cStart).join(" ");

  const parts: string[] = [windowA];
  if (bStart > aEnd) parts.push("[...]");
  if (bEnd > bStart) parts.push(words.slice(bStart, bEnd).join(" "));
  if (bEnd < cStart) parts.push("[...]");
  parts.push(windowC);

  return { text: parts.join("\n"), isWindowed: true };
}
