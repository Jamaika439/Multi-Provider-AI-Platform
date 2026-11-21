'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_login: string | null;
  blocked: boolean;
  can_agent?: boolean;
  chat_count: number;
  requests_total: number;
  requests_today: number;
  tokens_total: number;
  tokens_today: number;
  images_today: number;
}

interface ProviderRow {
  provider: string;
  requests_today: number;
  tokens_today: number;
}

interface AdminData {
  users: UserRow[];
  providers: ProviderRow[];
}

const num = (value: number | undefined) => (value ?? 0).toLocaleString('de-DE');

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString('de-DE') : '–';

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/users');
    if (response.status === 401) {
      setAuthed(false);
      return;
    }
    if (!response.ok) {
      setError('Die Liste konnte nicht geladen werden.');
      return;
    }
    // Toleriert auch das alte Antwortformat (nur eine Liste)
    const data = (await response.json()) as AdminData | UserRow[];
    setUsers(Array.isArray(data) ? data : (data.users ?? []));
    setProviders(Array.isArray(data) ? [] : (data.providers ?? []));
    setAuthed(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/users')
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          setAuthed(false);
          return;
        }
        if (!response.ok) {
          setError('Die Liste konnte nicht geladen werden.');
          return;
        }
        const data = (await response.json()) as AdminData | UserRow[];
        setUsers(Array.isArray(data) ? data : (data.users ?? []));
        setProviders(Array.isArray(data) ? [] : (data.providers ?? []));
        setAuthed(true);
      })
      .catch(() => {
        if (!cancelled) setError('Der Server ist nicht erreichbar.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Anmeldung fehlgeschlagen.');
      return;
    }
    setPassword('');
    await load();
  };

  const logout = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    setUsers([]);
    setProviders([]);
    setAuthed(false);
  };

  const setBlocked = async (user: UserRow, blocked: boolean) => {
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, blocked }),
    });
    await load();
  };

  const setAgent = async (user: UserRow, canAgent: boolean) => {
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, canAgent }),
    });
    await load();
  };

  const remove = async (user: UserRow) => {
    if (!confirm(`${user.email} samt allen Chats endgültig löschen?`)) return;
    await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id }),
    });
    await load();
  };

  if (authed === null) {
    return <div className="min-h-dvh bg-zinc-950 p-6 text-zinc-500">Lade…</div>;
  }

  if (!authed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950 p-4 text-zinc-100">
        <form
          onSubmit={login}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
        >
          <h1 className="text-lg font-bold">Admin-Anmeldung</h1>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Admin-Passwort"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
          />
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium transition hover:bg-indigo-500"
          >
            Anmelden
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-950 p-4 text-zinc-100 md:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Konten ({users.length})</h1>
          <div className="flex gap-2">
            <Link
              href="/"
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
            >
              Zum Chat
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
            >
              Admin abmelden
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Verbrauch heute je Anbieter (Tag = UTC)
          </p>
          {providers.length === 0 ? (
            <p className="text-xs text-zinc-500">Heute noch keine Anfragen.</p>
          ) : (
            <div className="flex flex-wrap gap-2 text-xs">
              {providers.map((row) => (
                <span
                  key={row.provider}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300"
                >
                  <span className="font-medium text-zinc-100">{row.provider}</span>:{' '}
                  {num(row.requests_today)} Anfragen, {num(row.tokens_today)} Tokens
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-3 py-2">E-Mail</th>
                <th className="px-3 py-2">Registriert</th>
                <th className="px-3 py-2">Letzter Login</th>
                <th className="px-3 py-2">Heute</th>
                <th className="px-3 py-2">Gesamt</th>
                <th className="px-3 py-2">Chats</th>
                <th
                  className="px-3 py-2"
                  title="Erlaubt den GitHub-Agent im Nur-Lesen-Modus (Repo ansehen). Ändern darf nur der Admin."
                >
                  Agent (lesen)
                </th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-zinc-800">
                  <td className="px-3 py-2">
                    <div>{user.email}</div>
                    <div className="font-mono text-[10px] text-zinc-600">{user.id}</div>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{formatDate(user.created_at)}</td>
                  <td className="px-3 py-2 text-zinc-400">{formatDate(user.last_login)}</td>
                  <td className="px-3 py-2 text-zinc-300">
                    {num(user.requests_today)} Anfr. · {num(user.tokens_today)} Tokens
                    {user.images_today > 0 && ` · ${num(user.images_today)} Bilder`}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {num(user.requests_total)} Anfr. · {num(user.tokens_total)} Tokens
                  </td>
                  <td className="px-3 py-2">{user.chat_count}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={user.can_agent === true}
                      onChange={(event) => void setAgent(user, event.target.checked)}
                      aria-label={`Agent für ${user.email} erlauben`}
                      className="h-4 w-4 accent-violet-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {user.blocked ? (
                      <span className="text-red-400">gesperrt</span>
                    ) : (
                      <span className="text-emerald-400">aktiv</span>
                    )}
                  </td>
                  <td className="space-x-2 px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void setBlocked(user, !user.blocked)}
                      className="rounded-md bg-zinc-800 px-2 py-1 transition hover:bg-zinc-700"
                    >
                      {user.blocked ? 'Entsperren' : 'Sperren'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(user)}
                      className="rounded-md bg-red-950/60 px-2 py-1 text-red-300 transition hover:bg-red-900/60"
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
                    Noch keine Konten.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
