# AI Platform 2026

Chat mit mehreren KI-Anbietern (Google, OpenAI, Groq, Mistral, SambaNova, Cohere, OpenRouter) plus Bildgenerierung über Pollinations. Chats werden lokal in `chat.db` (SQLite via sql.js) gespeichert.

## Start

```bash
npm install
cp .env.example .env.local   # danach Keys eintragen
npm run dev
```

Öffne http://localhost:3000. Nur Anbieter, deren Key in `.env.local` steht, funktionieren. Für die anderen erscheint eine Fehlermeldung im Chat.

## Modelle ändern

Alle Modelle stehen in `lib/models.ts` (Anzeigename, Gruppe, Anbieter, Modell-ID). Dort eintragen oder korrigieren, Dropdown und Server passen sich automatisch an.

## Aufbau

- `app/page.tsx`: Chat-Oberfläche
- `app/api/chat/route.ts`: Streaming-Antworten und Speichern des Verlaufs
- `app/api/chats/`: Chatliste, Nachrichten laden, Chat löschen
- `lib/db.ts`: SQLite-Zugriff
- `lib/providers.ts`: Anbieter-Anbindung (serverseitig)
- `lib/models.ts`: Modellliste (IDs bei Bedarf hier korrigieren)
- `lib/messages.ts`: Hilfen für Nachrichtentexte

## Offene Aufgaben

Siehe [TODO.md](TODO.md).

## Prüfen

```bash
npx tsc --noEmit
npm run lint
```
