import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function WikiMarkdown({
  content,
  onWikiLinkClick,
}: {
  content: string;
  onWikiLinkClick: (title: string) => void;
}) {
  // We can pre-process the content to convert [[Title]] to [Title](#wiki:Title)
  // so ReactMarkdown parses it as a link.
  const processedContent = content.replace(/\[\[(.*?)\]\]/g, "[$1](#wiki:$1)");

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => {
          if (href?.startsWith("#wiki:")) {
            const title = decodeURIComponent(href.replace("#wiki:", ""));
            return (
              <button
                type="button"
                className="text-violet-400 underline decoration-violet-400/30 hover:text-violet-300 hover:decoration-violet-400"
                onClick={() => onWikiLinkClick(title)}
              >
                {children}
              </button>
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
        p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
        h1: ({ children }) => <h1 className="text-3xl font-heading font-bold mb-4 mt-8">{children}</h1>,
        h2: ({ children }) => <h2 className="text-2xl font-heading font-semibold mb-3 mt-6">{children}</h2>,
        h3: ({ children }) => <h3 className="text-xl font-heading font-medium mb-2 mt-4">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="mb-4 border-l-2 border-violet-600/50 pl-4 italic text-violet-600">
            {children}
          </blockquote>
        ),
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
}