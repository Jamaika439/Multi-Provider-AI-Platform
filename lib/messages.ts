/**
 * lib/messages.ts
 * =============================================================================
 * Kleine Hilfsfunktionen rund um Nachrichtentexte. Client (page.tsx) und Server
 * (route.ts) nutzen dieselben Funktionen, damit beide Seiten Nachrichten gleich
 * verstehen.
 *
 * Hintergrund: In der AI-SDK-Version dieses Projekts besteht eine Nachricht
 * (UIMessage) nicht aus einem einfachen Textfeld, sondern aus einer Liste von
 * "parts" (Text, Reasoning, Werkzeugaufrufe, ...). Für Anzeige und Speicherung
 * brauchen wir daraus meist nur den reinen Text.
 * =============================================================================
 */

/**
 * Trennzeile, die beim Senden zwischen Nutzertext und Dateiinhalten steht
 * (siehe buildPrompt in page.tsx). Sie dient als Erkennungsmerkmal, damit die
 * Oberfläche angehängte Dateien als kleine Chips statt als Textblock zeigt.
 */
export const ATTACHMENT_MARKER = '[Angehängte Dateien]';

/** Minimale Form eines "part", die wir brauchen. */
interface TextLikePart {
  type: string;
  text?: unknown;
}

/**
 * Setzt den Text einer Nachricht aus allen Text-Parts zusammen.
 * Andere Part-Typen (z. B. "reasoning" = Denkschritte des Modells) werden
 * bewusst ignoriert, damit sie nicht im Chat oder in der Datenbank landen.
 */
export function getMessageText(message: {
  parts?: readonly TextLikePart[];
}): string {
  if (!Array.isArray(message.parts)) {
    return '';
  }

  return message.parts
    .filter(
      (part): part is TextLikePart & { text: string } =>
        part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('');
}

/**
 * Trennt den eigentlichen Nachrichtentext vom angehängten Dateiinhalt.
 *
 * Beispiel-Eingabe:
 *   "Fasse das zusammen\n\n[Angehängte Dateien]\n\n--- Datei: a.txt ---\n...."
 * Ergebnis:
 *   { text: "Fasse das zusammen", fileNames: ["a.txt"] }
 *
 * Gibt es keinen Marker, kommt der Text unverändert zurück.
 */
export function splitAttachments(text: string): {
  text: string;
  fileNames: string[];
} {
  const markerIndex = text.indexOf(ATTACHMENT_MARKER);

  if (markerIndex === -1) {
    return { text, fileNames: [] };
  }

  // Alles ab dem Marker ist Dateiinhalt. Daraus lesen wir nur die Dateinamen.
  const attachmentPart = text.slice(markerIndex);
  const fileNames = Array.from(
    attachmentPart.matchAll(/^--- Datei: (.+) ---$/gm),
    (match) => match[1]
  );

  return { text: text.slice(0, markerIndex).trim(), fileNames };
}

/**
 * Erzeugt den Chat-Titel für die Seitenleiste aus der ersten Nutzernachricht.
 * Regeln: Dateiinhalte zählen nicht mit. Gibt es nur Dateien, dient der erste
 * Dateiname als Titel. Zeilenumbrüche werden zu Leerzeichen, und ab 50 Zeichen
 * wird mit "…" gekürzt.
 */
export function makeChatTitle(firstUserText: string): string {
  const { text, fileNames } = splitAttachments(firstUserText);
  const base = text.trim() || fileNames[0] || 'Neuer Chat';
  const singleLine = base.replace(/\s+/g, ' ');

  return singleLine.length > 50 ? `${singleLine.slice(0, 50)}…` : singleLine;
}
