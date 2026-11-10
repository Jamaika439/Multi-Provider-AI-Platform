'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Anmeldung fehlgeschlagen.');
        return;
      }
      router.replace('/');
    } catch {
      setError('Der Server ist nicht erreichbar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2 text-lg font-bold">
          <Sparkles className="h-5 w-5 text-indigo-400" />
          AI Platform 2026
        </div>
        <p className="text-sm text-zinc-400">
          {mode === 'login' ? 'Melde dich an.' : 'Neues Konto erstellen.'}
        </p>

        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="E-Mail"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
        />
        <input
          type="password"
          required
          minLength={mode === 'register' ? 8 : undefined}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={mode === 'register' ? 'Passwort (mind. 8 Zeichen)' : 'Passwort'}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
        />

        {error && (
          <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {busy ? 'Bitte warten…' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
          className="w-full text-xs text-zinc-400 transition hover:text-zinc-200"
        >
          {mode === 'login'
            ? 'Noch kein Konto? Registrieren'
            : 'Schon ein Konto? Anmelden'}
        </button>
      </form>
    </div>
  );
}
