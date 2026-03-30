import React from "react";
import type { Components } from "react-markdown";

export const sharedMarkdownComponents: Partial<Components> = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      className="text-violet-400 underline decoration-violet-500/40 hover:text-violet-300"
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h1 className="text-3xl font-heading font-bold mb-4 mt-8">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-2xl font-heading font-semibold mb-3 mt-6">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-xl font-heading font-medium mb-2 mt-4">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-2 border-violet-600/50 pl-4 italic text-violet-600">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isInline = !className;
    return isInline ? (
      <code className="border border-violet-800/60 bg-violet-950/40 px-1 py-0.5 text-[0.9em] text-violet-200">
        {children}
      </code>
    ) : (
      <code className="block overflow-x-auto border border-violet-700/40 bg-black p-3 text-[0.9em] text-violet-100/90">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
};
