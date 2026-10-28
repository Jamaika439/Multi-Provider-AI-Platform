'use client'

import React, { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { codeToHtml } from 'shiki'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const [renderedContent, setRenderedContent] = useState(content)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function highlightCodeBlocks() {
      setIsLoading(true)
      try {
        const html = await ReactMarkdownToHtml(content)
        if (!cancelled) setRenderedContent(html)
      } catch (e) {
        if (!cancelled) setRenderedContent(content)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    highlightCodeBlocks()
    return () => { cancelled = true }
  }, [content])

  if (isLoading) {
    return <div className="prose dark:prose-invert max-w-none opacity-50">{content}</div>
  }

  return (
    <div
      className="prose dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: renderedContent }}
    />
  )
}

async function ReactMarkdownToHtml(markdown: string): Promise<string> {
  // Codeblöcke mit shiki hervorgeben, Rest roh laten
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  let result = markdown
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const lang = match[1] || 'text'
    const code = match[2]
    try {
      const highlighted = await codeToHtml(code, { lang, theme: 'github-dark' })
      result = result.replace(match[0], highlighted)
    } catch {
      // fallback: original behalten
    }
  }

  // Optional: auch Inline-Code einfärben (kleine Zeichenketten ````)
  // Hier ausgelassen für Einfachheit, da Gebotene Schwerpunkt!

  // Rest durch light-weight Markdown-Parser: strikt überprüfen, ob perlu
  // Debug-Schild: falls Markdown komplex (!) wird hier prüfen
  return result
}