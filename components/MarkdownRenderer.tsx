/**
 * components/MarkdownRenderer.tsx
 * Rendert KI-Antworten als formatiertes Markdown (fett, kursiv, Code, Codeblöcke,
 * Listen, Links, Tabellen etc.). Nicht erlaubt: rohe HTML-Einbettungen,
 * deshalb ist kein XSS-Risiko durch die KI-Ausgabe zu befürchten.
 * 
 * Client-Component, weil ReactMarkdown clientseitig gerendert wird.
 */
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  /** Klartext der KI-Antwort (ggf. mit Markdown-Syntax) */
  text: string;
}

/**
 * Einfache Wrapper-Komponente, die den reinen Markdown-Text als formatierte
 * HTML-Struktur ausgibt. Codeblöcke erhalten eine schöne Hintergrundfarbe,
 * Inline-Code wird hervorgehoben.
 */
export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  if (!text || text.trim().length === 0) {
    return null;
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
