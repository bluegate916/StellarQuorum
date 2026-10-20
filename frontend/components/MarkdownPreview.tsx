'use client';

import { renderMarkdown } from "@/lib/markdown";

interface MarkdownPreviewProps {
  content: string;
}

export default function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = renderMarkdown(content);

  return (
    <div
      className="text-sm text-slate-300 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
