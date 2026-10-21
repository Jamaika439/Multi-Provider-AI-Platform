import { tool } from 'ai';
import { z } from 'zod';

const OWNER = 'Jamaika439';
const REPO = 'Multi-Provider-AI-Platform';
const BASE_BRANCH = 'main';
export const AGENT_BRANCH = 'agent-work'; // Agent schreibt NIE direkt auf main

async function gh(path: string, init?: RequestInit) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

function encodePath(path: string) {
  return encodeURIComponent(path).replace(/%2F/g, '/');
}

async function ensureBranch() {
  try {
    await gh(`/git/ref/heads/${AGENT_BRANCH}`);
  } catch {
    const base = await gh(`/git/ref/heads/${BASE_BRANCH}`);
    await gh('/git/refs', {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${AGENT_BRANCH}`,
        sha: base.object.sha,
      }),
    });
  }
}

/** Liest eine Datei. ref = Branch oder Commit-SHA (Standard: Agent-Branch). */
async function getFile(path: string, ref: string = AGENT_BRANCH) {
  await ensureBranch();
  const data = await gh(`/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  return {
    sha: data.sha as string,
    text: Buffer.from(data.content, 'base64').toString('utf8'),
  };
}

async function putFile(
  path: string,
  text: string,
  message: string,
  sha?: string
) {
  await ensureBranch();
  return gh(`/contents/${encodePath(path)}`, {
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
    description:
      'Liest eine Datei mit Zeilennummern. Für große Dateien offset/limit nutzen. Mit ref (Commit-SHA aus fileHistory) wird eine ältere Version gelesen.',
    inputSchema: z.object({
      path: z.string(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1500).default(400),
      ref: z.string().optional(),
    }),
    execute: async ({ path, offset, limit, ref }) => {
      const { text } = await getFile(path, ref);
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

  fileHistory: tool({
    description:
      'Zeigt die letzten Commits einer Datei auf dem Agent-Branch (SHA, Nachricht, Datum). Damit lassen sich ältere Versionen per readFile(ref) lesen und wiederherstellen.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      await ensureBranch();
      const commits = await gh(
        `/commits?sha=${AGENT_BRANCH}&path=${encodeURIComponent(path)}&per_page=10`
      );
      return (
        commits as {
          sha: string;
          commit: { message: string; author: { date: string } };
        }[]
      ).map((c) => ({
        sha: c.sha,
        message: c.commit.message.split('\n')[0],
        date: c.commit.author.date,
      }));
    },
  }),

  editFile: tool({
    description:
      'Ersetzt GENAU EINE Stelle (old_str muss exakt und eindeutig vorkommen) und committet auf den Agent-Branch. Bevorzugtes Werkzeug für Änderungen an bestehenden Dateien.',
    inputSchema: z.object({
      path: z.string(),
      old_str: z.string().min(1),
      new_str: z.string(),
      message: z.string().default('agent: edit'),
    }),
    execute: async ({ path, old_str, new_str, message }) => {
      const { text, sha } = await getFile(path);
      const count = text.split(old_str).length - 1;
      if (count !== 1) {
        return {
          ok: false,
          error: `old_str kommt ${count}x vor (muss genau 1x vorkommen).`,
        };
      }
      await putFile(path, text.replace(old_str, () => new_str), message, sha);
      return { ok: true };
    },
  }),

  writeFile: tool({
    description:
      'Legt eine NEUE Datei an. Eine bestehende Datei wird nur überschrieben, wenn overwrite=true gesetzt ist; vorher MUSS sie mit readFile gelesen worden sein.',
    inputSchema: z.object({
      path: z.string(),
      content: z.string(),
      message: z.string().default('agent: write file'),
      overwrite: z.boolean().default(false),
    }),
    execute: async ({ path, content, message, overwrite }) => {
      let sha: string | undefined;
      try {
        sha = (await getFile(path)).sha;
      } catch {
        /* Datei existiert noch nicht */
      }

      if (sha && !overwrite) {
        return {
          ok: false,
          error:
            'Datei existiert bereits. Erst mit readFile lesen und mit editFile ändern. Nur wenn der Nutzer ein komplettes Neuschreiben will: overwrite=true.',
        };
      }

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
        {
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
          },
        }
      );
      const json = await res.json();
      return (json.items ?? []).slice(0, 20).map((i: { path: string }) => i.path);
    },
  }),
};

export const AGENT_SYSTEM = `Du bist ein Senior Software Engineer im Repository-Agent-Modus.
Du siehst frühere Tool-Aufrufe aus dem Chatverlauf NICHT. Gehe daher nie davon aus, wie eine Datei aussieht.

Pflicht-Ablauf:
1. Bestehende Dateien: IMMER zuerst mit listFiles/searchCode finden und mit readFile lesen, bevor du etwas änderst.
2. Änderungen an bestehenden Dateien machst du mit editFile (kleine, gezielte Ersetzungen). Überschreibe NIEMALS eine bestehende Datei komplett, außer der Nutzer verlangt ausdrücklich ein Neuschreiben (dann writeFile mit overwrite=true).
3. writeFile ist für neue Dateien gedacht.
4. Wenn der Nutzer etwas weiterentwickeln will, das es schon gibt, baue auf der vorhandenen Datei auf, statt sie neu zu erfinden.
5. Zum Wiederherstellen alter Stände: fileHistory, dann readFile mit ref.
6. Prüfe Änderungen am Ende mit readFile gegen und antworte mit einer kurzen Zusammenfassung.`;