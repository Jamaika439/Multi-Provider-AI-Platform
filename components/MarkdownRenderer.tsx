/**
 * components/MarkdownRenderer.tsx
 * Rendert KI-Antworten als formatiertes Markdown (fett, kursiv, Code, Codeblöcke,
 * Listen, Links, Tabellen etc.). Nicht erlaubt: rohe HTML-Einbettungen,
 * deshalb ist kein XSS-Risiko durch die KI-Ausgabe zu befürchten.
 *
 * Client-Component, weil ReactMarkdown clientseitig gerendert wird.
 */
'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlight } from 'shiki'

interface MarkdownRendererProps {
  /** Klartext der KI-Antwort (ggf. mit Markdown-Syntax) */
  text: string
}

/**
 * Einfache Wrapper-Komponente, die den reinen Markdown-Text als formatierte
 * HTML-Struktur ausgibt. Codeblöcke erhalten Syntax-Highlighting via Shiki,
 * Inline-Code wird hervorgehoben.
 */
export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  if (!text || text.trim().length === 0) {
    return null
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom code block component for fenced code blocks
          code: ({ node, children, ...props }) => {
            const className = props.className as string | undefined
            const lang = className?.replace(/^language-/, '') ?? 'plaintext'
            const codeString = typeof children === 'string' ? children : String(children)

            const { html } = highlight({
              code: codeString,
              lang,
              theme: 'github-dark',
            })

            return (
              <pre className="rounded-md bg-zinc-900 p-4 overflow-x-auto mb-4">
                <code
                  className={className}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </pre>
            )
          },
          // Inline code component
          inlineCode: ({ children, ...props }) => (
            <code
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-emerald-300 font-mono text-sm"
              {...props}
            >
              {children}
            </code>
          ),
          // Blockquote styling
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-l-4 border-indigo-500 pl-4 my-4 italic text-zinc-300"
              {...props}
            >
              {children}
            </blockquote>
          ),
          // Table styling
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse border border-zinc-700" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-200"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              className="border border-zinc-700 px-3 py-2 text-sm text-zinc-200"
              {...props}
            >
              {children}
            </td>
          ),
          // HR styling
          hr: () => (
            <hr className="border-zinc-800 my-6" />
          ),
          // Link styling
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline"
              {...props}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}