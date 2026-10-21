import { tool } from 'ai';
import { z } from 'zod';

const OWNER = 'Jamaika439';
const REPO = 'Multi-Provider-AI-Platform';
const BASE_BRANCH = 'main';
export const AGENT_BRANCH = 'agent-work'; // Agent schreibt NIE direkt auf main

async function gh(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function ensureBranch() {
  try {
    await gh(`/git/ref/heads/${AGENT_BRANCH}`);
  } catch {
    const base = await gh(`/git/ref/heads/${BASE_BRANCH}`);
    await gh('/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${AGENT_BRANCH}`, sha: base.object.sha }),
    });
  }
}

async function getFile(path: string) {
  await ensureBranch();
  const data = await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${AGENT_BRANCH}`);
  return {
    sha: data.sha as string,
    text: Buffer.from(data.content, 'base64').toString('utf8'),
  };
}

async function putFile(path: string, text: string, message: string, sha?: string) {
  await ensureBranch();
  return gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(text, 'utf8').toString('base64'),
      branch: AGENT_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

export const agentTools = {
  listFiles: tool({
    description: 'Listet alle Dateipfade im Repo (optional gefiltert nach Präfix).',
    inputSchema: z.object({ prefix: z.string().optional() }),
    execute: async ({ prefix }) => {
      await ensureBranch();
      const tree = await gh(`/git/trees/${AGENT_BRANCH}?recursive=1`);
      return (tree.tree as { path: string; type: string }[])
        .filter((n) => n.type === 'blob' && (!prefix || n.path.startsWith(prefix)))
        .map((n) => n.path)
        .slice(0, 500);
    },
  }),

  readFile: tool({
    description: 'Liest eine Datei mit Zeilennummern. Für große Dateien offset/limit nutzen.',
    inputSchema: z.object({
      path: z.string(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1500).default(400),
    }),
    execute: async ({ path, offset, limit }) => {
      const { text } = await getFile(path);
      const lines = text.split('\n');
      return {
        totalLines: lines.length,
        content: lines
          .slice(offset, offset + limit)
          .map((l, i) => `${String(offset + i + 1).padStart(5)} | ${l}`)
          .join('\n'),
      };
    },
  }),

  editFile: tool({
    description:
      'Ersetzt GENAU EINE Stelle (old_str muss exakt und eindeutig vorkommen) und committet auf den Agent-Branch.',
    inputSchema: z.object({
      path: z.string(),
      old_str: z.string().min(1),
      new_str: z.string(),
      message: z.string().default('agent: edit'),
    }),
    execute: async ({ path, old_str, new_str, message }) => {
      const { text, sha } = await getFile(path);
      const count = text.split(old_str).length - 1;
      if (count !== 1) return { ok: false, error: `old_str kommt ${count}x vor (muss genau 1x vorkommen).` };
      await putFile(path, text.replace(old_str, () => new_str), message, sha);
      return { ok: true };
    },
  }),

  writeFile: tool({
    description: 'Schreibt/überschreibt eine komplette Datei und committet auf den Agent-Branch.',
    inputSchema: z.object({
      path: z.string(),
      content: z.string(),
      message: z.string().default('agent: write file'),
    }),
    execute: async ({ path, content, message }) => {
      let sha: string | undefined;
      try { sha = (await getFile(path)).sha; } catch { /* neue Datei */ }
      await putFile(path, content, message, sha);
      return { ok: true, bytes: content.length };
    },
  }),

  searchCode: tool({
    description: 'Sucht einen String im Repo (GitHub Code Search).',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const res = await fetch(
        `https://api.github.com/search/code?q=${encodeURIComponent(`${query} repo:${OWNER}/${REPO}`)}`,
        { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } }
      );
      const json = await res.json();
      return (json.items ?? []).slice(0, 20).map((i: { path: string }) => i.path);
    },
  }),
};

export const AGENT_SYSTEM = `Du bist ein Senior Software Engineer im Repository-Agent-Modus.
Arbeitsweise: 1) listFiles/searchCode/readFile zum Verstehen, 2) kurzer Plan, 3) editFile für kleine Änderungen,
writeFile für neue oder komplett neu geschriebene Dateien, 4) Änderung per readFile gegenprüfen.
Ändere nur, was nötig ist. Eine Datei pro Tool-Call. Antworte am Ende mit einer kurzen Zusammenfassung.`;