# Was jetzt zu tun ist

Stand: 29.09.2026. Reihenfolge von oben nach unten abarbeiten.

## 1. Projekt aktualisieren (5 Minuten)

- [ ] Server im Terminal mit `Ctrl+C` beenden.
- [ ] Neue ZIP entpacken und alle Dateien in deinen Projektordner kopieren, vorhandene Dateien **überschreiben**.
- [ ] Ordner `.next` löschen (alter Cache): `Remove-Item -Recurse -Force .next`
- [ ] `npm install` ausführen.
- [ ] Deine alte `.env.local` und `chat.db` (falls du deine Chats behalten willst) wieder in den Ordner legen. Beide sind bewusst nicht in der ZIP.
- [ ] `npm run dev` starten und http://localhost:3000 öffnen.

## 2. API-Keys prüfen (die Fehler, die nicht am Code liegen)

Jeden Key kannst du in PowerShell direkt testen. Ersetze `DEIN_KEY`. Kommt eine Liste zurück, ist der Key in Ordnung. Kommt ein Fehler, ist der Key falsch, abgelaufen oder gesperrt.

- [ ] **Mistral ("Unauthorized")**: Key testen:
  `curl.exe https://api.mistral.ai/v1/models -H "Authorization: Bearer DEIN_KEY"`
  Bei einem Fehler unter console.mistral.ai einen neuen Key erzeugen und in `.env.local` bei `MISTRAL_API_KEY` eintragen.
- [ ] **OpenRouter ("Missing Authentication header")**: Der Code sendet den Key nachweislich mit. Also prüfen, ob `OPENROUTER_API_KEY` in `.env.local` wirklich gesetzt ist (Format `sk-or-v1-...`). Test:
  `curl.exe https://openrouter.ai/api/v1/auth/key -H "Authorization: Bearer DEIN_KEY"`
- [ ] **OpenAI ("no credits remaining")**: Entweder Guthaben aufladen (platform.openai.com/settings/organization/billing) oder die OpenAI-Modelle einfach nicht benutzen. Ein Code-Fehler ist das nicht.
- [ ] **Groq, SambaNova, Cohere, Google**: Wenn nach dem Update noch "Unauthorized" oder "invalid api key" kommt, gilt dasselbe wie bei Mistral. Die Test-Adressen:
  - Groq: `https://api.groq.com/openai/v1/models`
  - Cohere: `https://api.cohere.com/v1/models`
- [ ] Nach jeder Änderung an `.env.local` den Server mit `Ctrl+C` beenden und neu starten. Next.js liest die Datei nur beim Start.
- [ ] Keine Anführungszeichen und keine Leerzeichen um den Key setzen, also `GROQ_API_KEY=gsk_...` (der Code räumt das zwar auf, aber so ist es sauber).

## 3. Jedes Modell einmal ausprobieren

- [ ] Pro Anbieter mit einem Key: "Hallo" schreiben. Die Modell-IDs wurden am 29.09.2026 in den Anbieter-Dokus geprüft.
- [ ] Kommt "model not found" oder "decommissioned": Modell-ID in `lib/models.ts` korrigieren. Aktuelle Listen stehen im Kommentar ganz oben in der Datei.
- [ ] Besonders wackelig sind die **OpenRouter-Gratis-Modelle** (wechseln ständig). Der `Free Router` ist am stabilsten.
- [ ] Nicht verifiziert: Ob dein Google-Key Zugriff auf `gemini-3.1-pro-preview` hat, hängt vom Konto ab.

## 4. Bildgenerierung

- [ ] Ausprobieren: Modell "Bildgenerierung (Pollinations)" wählen, Beschreibung senden, danach direkt eine zweite.
- [ ] Neu: Lädt ein Bild nicht, gibt es nach 4 Sekunden einen automatischen zweiten Versuch und danach den Button "Erneut versuchen". Die Seite muss nicht mehr neu geladen werden.
- [ ] Bitte melden, falls es trotzdem hängt. Dann brauche ich den Text aus dem Terminal und aus der Browser-Konsole (F12). Ich konnte den Fehler in meinen Tests nicht nachstellen. Vermutlich lag es am Bilddienst.

## 5. Sicherheit

- [ ] **Alte API-Keys austauschen**, falls du die ursprüngliche ZIP (mit `.env.local` darin) irgendwo geteilt oder hochgeladen hast. Auch die Keys, die in dieser Unterhaltung als Datei angehängt waren.
- [ ] `.env.local` und `chat.db` nie weitergeben. Beide stehen jetzt in `.gitignore`, falls du Git benutzt.

## 6. Empfohlen

- [ ] Projekt aus OneDrive herausschieben (z. B. nach `C:\dev\my-ai-platform`). OneDrive synchronisiert `node_modules` und `.next` und kann Dateien sperren (`EPERM`, `EBUSY`, langsame Starts).
- [ ] Sicherung von `chat.db` anlegen, sie enthält alle deine Chats.

## 7. Später, wenn du magst

- [ ] Antworten mit Markdown und Codeblöcken formatiert anzeigen (aktuell reiner Text).
- [ ] Bilder als Anhang unterstützen (aktuell nur Textdateien).
- [ ] Bildgenerierung über einen Anbieter mit Key statt über die freie Pollinations-Adresse (zuverlässiger).
- [ ] Anmeldung/Passwortschutz, bevor du die App ins Internet stellst. Aktuell kann jeder, der die Adresse erreicht, deine Keys benutzen.
