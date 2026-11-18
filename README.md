# AI Platform 2026

Chat mit mehreren KI-Anbietern (Google, OpenAI, Groq, Cohere, OpenRouter) plus Bildgenerierung über Pollinations.
Mit Benutzerkonten, Admin-Bereich und einem Agent-Modus, der das eigene GitHub-Repo bearbeiten kann.

- Live: https://multi-provider-ai-platform.vercel.app
- Chats und Konten liegen in Neon (PostgreSQL).

## Start (lokal)

```
npm install
cp .env.example .env.local   # danach Werte eintragen
npm run dev
```

Öffne http://localhost:3000. Nur Anbieter, deren Key in `.env.local` steht, funktionieren. Für die anderen erscheint eine Fehlermeldung im Chat.
Nach jeder Änderung an `.env.local` den Server neu starten. Auf Vercel stehen die Werte unter Settings, Environment Variables (danach neu deployen).

## Konten und Admin

- Jeder kann sich unter `/login` registrieren. Jeder sieht nur seine eigenen Chats.
- `/admin` hat ein eigenes Passwort (`ADMIN_PASSWORD`): Konten ansehen, sperren, entsperren, löschen.
- Bezahlte Modelle und der Agent-Modus sind nur nutzbar, wenn du im selben Browser unter `/admin` angemeldet bist (8 Stunden).
- Die Tabellen `users` und `chat_owners` legt der Code beim ersten Aufruf selbst an.

## Mehrere Keys

Pro Anbieter kannst du Ersatz-Keys mit `_2` und `_3` eintragen. Bei Fehler 401, 402, 403 oder 429 wechselt die App automatisch (`lib/failover-fetch.ts`).
Das hilft nur, wenn der Ersatz-Key ein eigenes Kontingent hat. Bei Google gilt das Limit pro Projekt, bei OpenRouter pro Konto.

## Agent-Modus

Schalter im runden Button unten rechts (nur als Admin). Der Agent arbeitet über die GitHub-API auf dem Branch `agent-work`, nie direkt auf `main`.
Dafür braucht es `GITHUB_TOKEN` (Fine-grained Token nur für dieses Repo, Contents: Read and write).
Ablauf: Agent ändert, Vercel baut den Branch als Preview, du prüfst und mergst per Pull Request nach `main`. Danach den Branch `agent-work` löschen.
Bearbeite damit keine `package.json`, `lib/auth.ts` oder `lib/agents/tools.ts`.

## Modelle ändern

Alle Modelle stehen in `lib/models.ts` (Anzeigename, Gruppe, Anbieter, Modell-ID). Gratis-Modelle bei OpenRouter verschwinden oft: Meldet ein Modell "No endpoints found", Eintrag löschen.

## Aufbau

- `app/page.tsx`: Chat-Oberfläche
- `app/login/page.tsx`, `app/admin/page.tsx`: Anmeldung und Admin
- `app/api/chat/route.ts`: Streaming-Antworten, Agent-Modus, Speichern
- `app/api/chats/`: Chatliste, Nachrichten laden, Chat löschen
- `app/api/auth/[action]/route.ts`: Registrieren, Anmelden, Abmelden
- `app/api/admin/`: Admin-Login und Konten-Verwaltung
- `app/api/health/route.ts`: Key-Test (nur für eingeloggte Nutzer)
- `lib/auth.ts`: Konten, Sessions, Chat-Zuordnung
- `lib/db.ts`: Neon-Zugriff, `lib/providers.ts` und `lib/failover-fetch.ts`: Anbieter und Key-Wechsel
- `lib/agents/tools.ts`: Werkzeuge des Agenten

## Prüfen

```
npx tsc --noEmit
npm run lint
```
