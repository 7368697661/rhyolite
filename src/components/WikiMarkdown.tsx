import React, { useCallback, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sharedMarkdownComponents } from "./markdownComponents";

export type EntityPreviewData = { title: string; snippet: string } | null;

function EntityLinkButton({
  title,
  onClick,
  resolveEntityPreview,
  children,
}: {
  title: string;
  onClick: () => void;
  resolveEntityPreview?: (title: string) => EntityPreviewData;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<EntityPreviewData>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = useCallback(() => {
    if (!resolveEntityPreview) return;
    timerRef.current = setTimeout(() => {
      const data = resolveEntityPreview(title);
      setPreview(data);
      setHover(true);
    }, 200);
  }, [resolveEntityPreview, title]);

  const onLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHover(false);
    setPreview(null);
  }, []);

  const onFocus = useCallback(() => {
    if (!resolveEntityPreview) return;
    const data = resolveEntityPreview(title);
    setPreview(data);
    setHover(true);
  }, [resolveEntityPreview, title]);

  const onBlur = useCallback(() => {
    setHover(false);
    setPreview(null);
  }, []);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="text-violet-400 underline decoration-violet-400/30 hover:text-violet-300 hover:decoration-violet-400 focus:text-violet-300 focus:decoration-violet-400"
        onClick={onClick}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {children}
      </button>
      {hover && preview && (
        <span className="absolute left-0 bottom-full mb-1 z-50 block w-[220px] border border-violet-600/60 bg-[#020005]/95 px-2 py-1.5 text-[10px] font-mono text-violet-300 shadow-lg pointer-events-none">
          <span className="block font-bold text-violet-200 truncate mb-0.5">{preview.title}</span>
          <span className="block leading-snug text-violet-400/90 line-clamp-4">{preview.snippet}</span>
        </span>
      )}
    </span>
  );
}

export function WikiMarkdown({
  content,
  onEntityLinkClick,
  resolveEntityPreview,
}: {
  content: string;
  onEntityLinkClick: (title: string) => void;
  resolveEntityPreview?: (title: string) => EntityPreviewData;
}) {
  const toEntityHref = (title: string) => `#entity:${encodeURIComponent(title)}`;

  const processedContent = useMemo(() => {
    return content
      // [[Title|display text]] → [display text](#entity:Title)
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, target, display) => `[${display.trim()}](#entity:${encodeURIComponent(target.trim())})`)
      // [[Title]] → [Title](#entity:Title)
      .replace(/\[\[([^\]]+)\]\]/g, (_m, title) => `[${title}](#entity:${encodeURIComponent(title)})`)
      .replace(/\]\(\s*<([^>]+)>\s*\)/g, (_m, inner) => `](#entity:${encodeURIComponent(inner)})`)
      .replace(/(?<!!)\[([^\]]{2,})\](?!\()/g, (m, inner) => {
        const t = String(inner).trim();
        if (!t) return m;
        if (t.startsWith("!")) return m;
        if (/^[x ]$/i.test(t)) return m;
        return `[${inner}](#entity:${encodeURIComponent(t)})`;
      });
  }, [content]);

  function textFromNode(node: any): string {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(textFromNode).join("");
    if (node && typeof node === "object" && node.props) return textFromNode(node.props.children);
    return "";
  }

  function extractCalloutType(node: any): string | null {
    const flat = textFromNode(node).trim();
    // e.g. "[!quote] something"
    const match = flat.match(/^\[!([a-zA-Z0-9_-]+)\]/);
    return match ? match[1] : null;
  }

  function stripCalloutMarkerFromChildren(childrenNode: any, calloutType: string) {
    const markerRegex = new RegExp(`^\\[!${calloutType}\\]\\s*`, "i");

    const walk = (node: any): any => {
      if (typeof node === "string") {
        return node.replace(markerRegex, "");
      }
      if (Array.isArray(node)) {
        const next = node.map(walk).filter((n) => n !== "" && n != null);
        return next.length === 1 ? next[0] : next;
      }
      if (React.isValidElement(node)) {
        const nextChildren = walk((node as any).props?.children);
        return React.cloneElement(node as any, undefined, nextChildren);
      }
      return node;
    };

    return walk(childrenNode);
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        ...sharedMarkdownComponents,
        a: ({ href, children, ...props }) => {
          if (href?.startsWith("#entity:") || href?.startsWith("#wiki:")) {
            const prefix = href.startsWith("#entity:") ? "#entity:" : "#wiki:";
            const title = decodeURIComponent(href.replace(prefix, ""));
            return (
              <EntityLinkButton
                title={title}
                onClick={() => onEntityLinkClick(title)}
                resolveEntityPreview={resolveEntityPreview}
              >
                {children}
              </EntityLinkButton>
            );
          }
          return (
            <a
              href={href}
              className="text-violet-400 underline decoration-violet-500/40 hover:text-violet-300"
              target="_blank"
              rel="noreferrer"
              {...props}
            >
              {children}
            </a>
          );
        },
        blockquote: ({ children }) => {
          const calloutType = extractCalloutType(children);
          if (calloutType) {
            const stripped = stripCalloutMarkerFromChildren(children, calloutType);
            return (
              <div className="mb-4 border border-violet-500/40 bg-violet-950/20 p-3">
                <blockquote className="m-0 border-l-2 border-violet-600/50 pl-4 text-violet-200">
                  {stripped}
                </blockquote>
              </div>
            );
          }

          return (
            <blockquote className="mb-4 border-l-2 border-violet-600/50 pl-4 italic text-violet-600">
              {children}
            </blockquote>
          );
        },
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
}