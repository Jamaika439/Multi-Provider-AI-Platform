/**
 * app/page.tsx
 * =============================================================================
 * Die komplette Chat-Oberfläche (läuft im Browser, daher 'use client').
 *
 * Aufbau der Datei:
 *   1. Typen              Formen der Daten, mit denen die Oberfläche arbeitet
 *   2. Konstanten         Limits, Muster, Modellgruppen
 *   3. GeneratedImage     kleine Komponente für erzeugte Bilder (mit Wiederholung)
 *   4. Home               die Hauptkomponente
 *        - State          alles, was sich ändern kann (Eingabe, Chats, Fehler ...)
 *        - Chatverlauf    laden, neu anlegen, löschen
 *        - Dateien        Upload per Button oder Drag-and-drop
 *        - Diktieren      Spracherkennung des Browsers
 *        - Senden         Nachricht bauen und abschicken
 *        - JSX            die sichtbare Oberfläche
 *
 * Zusammenspiel mit dem Server:
 *   - useChat (Vercel AI SDK) schickt Nachrichten an /api/chat und zeigt die
 *     gestreamte Antwort live an.
 *   - Die Chatliste und gespeicherte Verläufe kommen von /api/chats.
 * =============================================================================
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

import {
  Bot,
  CheckCircle2,
  FileText,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
  XCircle,
} from 'lucide-react';

import {
  ATTACHMENT_MARKER,
  getMessageText,
  splitAttachments,
} from '@/lib/messages';
import {
  DEFAULT_MODEL,
  IMAGE_MODEL,
  MODELS,
  getModelGroups,
  type ModelKey,
} from '@/lib/models';

// =============================================================================
// 1. Typen
// =============================================================================

/** Ein Eintrag in der Chatliste der Seitenleiste (Antwort von GET /api/chats). */
interface ChatItem {
  id: string;
  title: string;
  created_at: string;
}

/** Eine gespeicherte Nachricht (Antwort von GET /api/chats/<id>): nur Klartext. */
interface StoredChatMessage {
  id: string;
  role: string;
  content: string;
}

/** Ergebnis des Verbindungstests für einen API-Key (Antwort von GET /api/health). */
interface KeyCheckResult {
  provider: string;
  keyName: string;
  configured: boolean;
  ok: boolean;
  status: number | null;
  message: string;
  /** Zusatzhinweis mit Erklärung und nächstem Schritt (optional). */
  hint?: string;
}

/** Eine Datei, die der Nutzer angehängt hat, aber noch nicht gesendet wurde. */
interface AttachedFile {
  name: string;
  content: string;
  size: number;
  /** true, wenn der Inhalt wegen des Zeichenlimits gekürzt wurde */
  truncated: boolean;
}

/*
 * Die Spracherkennung des Browsers ist noch nicht in den offiziellen
 * TypeScript-Typen enthalten. Diese Schnittstellen beschreiben nur den Teil,
 * den wir benutzen.
 */
interface SpeechRecognitionEventLike {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

/** Teilt TypeScript mit, dass `window` diese Spracherkennung haben kann. */
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

// =============================================================================
// 2. Konstanten
// =============================================================================

/** Maximale Zeichenzahl pro angehängter Datei. Längere Dateien werden gekürzt. */
const FILE_MAX_CHARS = 30_000;

/** Maximale Zeichenzahl aller angehängten Dateien zusammen. */
const TOTAL_FILE_MAX_CHARS = 80_000;

/**
 * Erkennt ein von der Bildgenerierung erzeugtes Markdown-Bild und holt die URL
 * heraus. Es werden nur Pollinations-URLs akzeptiert, damit nie beliebige
 * fremde Adressen als Bild geladen werden.
 */
const IMAGE_MARKDOWN =
  /!\[[^\]]*\]\((https:\/\/image\.pollinations\.ai\/[^)\s]+)\)/;

/** Modelle, nach Gruppen sortiert, einmal berechnet für das Dropdown. */


/**
 * Verbindung zum Server. Wird EINMAL außerhalb der Komponente angelegt: Würde
 * sie bei jedem Rendern neu entstehen, könnte useChat den Chat zurücksetzen.
 */
const transport = new DefaultChatTransport({ api: '/api/chat' });

/** Erzeugt eine neue, eindeutige Chat-ID wie "chat-3f2a...". */
function createChatId() {
  return `chat-${crypto.randomUUID()}`;
}

/** Holt die Bild-URL aus einem Antworttext, oder null, wenn dort kein Bild steht. */
function getImageUrl(text: string): string | null {
  return text.match(IMAGE_MARKDOWN)?.[1] ?? null;
}

// =============================================================================
// 3. GeneratedImage: zeigt ein erzeugtes Bild und fängt Ladefehler ab
// =============================================================================

/**
 * Pollinations erzeugt das Bild erst, wenn der Browser die URL abruft. Das
 * kann länger dauern, und der Dienst lehnt Anfragen gelegentlich ab (z. B.
 * wenn kurz zuvor schon ein Bild angefordert wurde).
 *
 * Deshalb: Schlägt das Laden fehl, wird nach 4 Sekunden automatisch EIN
 * weiterer Versuch gestartet. Klappt auch der nicht, erscheint eine Meldung
 * mit Button "Erneut versuchen". Ohne diese Komponente bliebe nur ein
 * kaputtes Bild-Symbol, und man müsste die Seite neu laden.
 */
function GeneratedImage({ url }: { url: string }) {
  // Zähler für Versuche. Ein Anhang wie "&retry=1" macht die URL neu, damit
  // der Browser nicht das fehlgeschlagene Ergebnis aus dem Cache nimmt.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const autoRetried = useRef(false);

  const src = attempt === 0 ? url : `${url}&retry=${attempt}`;

  const handleError = () => {
    if (!autoRetried.current) {
      // Erster Fehler: nach kurzer Pause automatisch nochmal versuchen.
      autoRetried.current = true;
      setTimeout(() => setAttempt((value) => value + 1), 4000);
      return;
    }

    setFailed(true);
  };

  const retryManually = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  if (failed) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-400">
        <p>
          Das Bild konnte nicht geladen werden. Der Bilddienst ist eventuell
          gerade ausgelastet.
        </p>

        <button
          type="button"
          onClick={retryManually}
          className="mt-2 rounded-md bg-zinc-800 px-3 py-1 text-zinc-200 transition hover:bg-zinc-700"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Externe, dynamische URL: next/image ist hier nicht sinnvoll */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt="Generiertes Bild"
        onError={handleError}
        className="max-w-full rounded-lg border border-zinc-700"
      />
    </>
  );
}

// =============================================================================
// 4. Hauptkomponente
// =============================================================================

export default function Home() {
  // ---------------------------------------------------------------------------
  // State: alles, was sich ändert und die Anzeige neu zeichnen lässt
  // ---------------------------------------------------------------------------

  /** Aktuell gewähltes Modell (Schlüssel aus lib/models.ts). */
  const [selectedModel, setSelectedModel] =
    useState<ModelKey>(DEFAULT_MODEL);

 const [onlyFree, setOnlyFree] = useState(true);
  /**
   * ID des aktuell offenen Chats. Sie wird beim Senden mit an den Server
   * geschickt, der damit den Verlauf in der Datenbank ablegt.
   */
  const [chatId, setChatId] = useState(createChatId);

  /** Chatliste für die Seitenleiste. */
  const [chats, setChats] = useState<ChatItem[]>([]);

  /** Text im Eingabefeld. */
  const [input, setInput] = useState('');

  /** Angehängte, noch nicht gesendete Dateien. */
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  /** true, solange der Nutzer eine Datei über das Fenster zieht. */
  const [isDragging, setIsDragging] = useState(false);

  /** true, solange die Spracherkennung zuhört. */
  const [isListening, setIsListening] = useState(false);

  /** Eigene Meldungen der Oberfläche (Upload-Hinweise, Ladefehler ...). */
  const [errorMessage, setErrorMessage] = useState('');

  /** Ergebnisse des Verbindungstests (null = noch nicht ausgeführt). */
  const [keyResults, setKeyResults] = useState<KeyCheckResult[] | null>(null);

  /** Welcher Verbindungstest läuft gerade? null = keiner. */
  const [checkingMode, setCheckingMode] = useState<'normal' | 'deep' | null>(
    null
  );
  const isCheckingKeys = checkingMode !== null;

  // Refs: Verweise, die sich ändern dürfen, ohne die Anzeige neu zu zeichnen.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // ---------------------------------------------------------------------------
  // Chatliste laden
  // ---------------------------------------------------------------------------

  /** Holt die Chatliste vom Server. Wird nach jeder fertigen Antwort erneut aufgerufen. */
  const fetchChats = useCallback(async () => {
    try {
      const response = await fetch('/api/chats');

      if (!response.ok) {
        throw new Error('Die Chatliste konnte nicht geladen werden.');
      }

      const data: ChatItem[] = await response.json();
      setChats(data);
    } catch (error) {
      console.error('Fehler beim Laden der Chats:', error);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // useChat: das Herzstück (AI SDK)
  //   messages     alle Nachrichten des offenen Chats
  //   sendMessage  schickt eine Nachricht an den Server
  //   status       'ready' | 'submitted' (gesendet, wartet) | 'streaming' (Antwort läuft) | 'error'
  //   setMessages  ersetzt den Verlauf (z. B. beim Laden eines alten Chats)
  //   stop         bricht die laufende Antwort ab
  //   error        letzter Fehler, z. B. vom Anbieter (falsche Modell-ID, kein Key ...)
  //   clearError   setzt den Fehler zurück
  // ---------------------------------------------------------------------------
  const { messages, sendMessage, status, setMessages, stop, error, clearError } =
    useChat<UIMessage>({
      transport,
      // Nach jeder fertigen Antwort die Chatliste aktualisieren, damit neue
      // Chats mit ihrem Titel erscheinen.
      onFinish: () => {
        void fetchChats();
      },
    });

  // Abgeleitete Werte, werden bei jedem Rendern aus dem State berechnet.
 const isLoading = status === 'submitted' || status === 'streaming';
const isImageModel = selectedModel === IMAGE_MODEL;

const selectedModelDef = MODELS.find((model) => model.key === selectedModel);
const selectedModelLabel = selectedModelDef?.label ?? '';

const modelGroups = getModelGroups(onlyFree);

const shownError = errorMessage || error?.message || '';
  // ---------------------------------------------------------------------------
  // Effekte: Code, der bei bestimmten Änderungen läuft
  // ---------------------------------------------------------------------------

  // Chatliste einmal beim Start laden. Der State wird erst im Promise-Callback
  // gesetzt, nicht synchron im Effekt (das würde ESLint zu Recht bemängeln).
  useEffect(() => {
    let cancelled = false;

    fetch('/api/chats')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Die Chatliste konnte nicht geladen werden.');
        }
        return response.json() as Promise<ChatItem[]>;
      })
      .then((data) => {
        if (!cancelled) setChats(data);
      })
      .catch((loadError) => {
        console.error('Fehler beim Laden der Chats:', loadError);
      });

    // Aufräumen: Ist die Komponente weg, bevor die Antwort kommt, nichts mehr setzen.
    return () => {
      cancelled = true;
    };
  }, []);

  // Bei jeder neuen Nachricht (und Statusänderung) ans Ende des Chats scrollen.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  // Beim Verlassen der Seite die Spracherkennung beenden.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Chatverlauf: neu anlegen, laden, löschen
  // ---------------------------------------------------------------------------

  /** Setzt Eingabefeld, Anhänge und Fehlermeldungen zurück. */
  const resetComposer = () => {
    setInput('');
    setAttachedFiles([]);
    setErrorMessage('');
    clearError();
  };

  /**
   * Lädt einen gespeicherten Chat aus der Datenbank.
   *
   * Gespeichert ist nur Klartext (role + content). useChat braucht aber
   * UIMessages mit "parts". Deshalb wird jede Nachricht hier umgebaut, sonst
   * ließe sich der alte Chat nicht weiterführen.
   */
  const loadChat = async (id: string) => {
    try {
      // Läuft gerade noch eine Antwort, wird sie abgebrochen.
      void stop();
      setErrorMessage('');
      clearError();

      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`);

      if (!response.ok) {
        throw new Error('Der Chat konnte nicht geladen werden.');
      }

      const history: StoredChatMessage[] = await response.json();

      const restored: UIMessage[] = history
        .filter(
          (message) => message.role === 'user' || message.role === 'assistant'
        )
        .map((message) => ({
          id: message.id,
          role: message.role as 'user' | 'assistant',
          parts: [{ type: 'text' as const, text: message.content }],
        }));

      setChatId(id);
      setMessages(restored);
      setInput('');
      setAttachedFiles([]);
    } catch (loadError) {
      console.error('Fehler beim Laden des Chats:', loadError);
      setErrorMessage('Der Chat konnte nicht geladen werden.');
    }
  };

  /** Beginnt einen neuen, leeren Chat mit frischer ID. */
  const createNewChat = () => {
    void stop();
    setChatId(createChatId());
    setMessages([]);
    resetComposer();
  };

  /**
   * Löscht einen Chat auf dem Server und entfernt ihn aus der Liste.
   * `stopPropagation` verhindert, dass der Klick auf das Papierkorb-Symbol
   * gleichzeitig den Chat öffnet.
   */
  const deleteChat = async (
    id: string,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();

    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Der Chat konnte nicht gelöscht werden.');
      }

      setChats((previousChats) =>
        previousChats.filter((chat) => chat.id !== id)
      );

      // War der gelöschte Chat gerade offen, mit einem neuen weitermachen.
      if (chatId === id) {
        createNewChat();
      }
    } catch (deleteError) {
      console.error('Fehler beim Löschen des Chats:', deleteError);
      setErrorMessage('Der Chat konnte nicht gelöscht werden.');
    }
  };

  // ---------------------------------------------------------------------------
  // Dateien anhängen (Button oder Drag-and-drop)
  // ---------------------------------------------------------------------------

  /**
   * Liest die gewählten Dateien als Text und hängt sie an.
   *
   * Schutzmaßnahmen:
   *  - Bilder werden übersprungen (sie lassen sich nicht als Text lesen).
   *  - Binärdateien (PDF, ZIP ...) enthalten Nullzeichen und werden abgelehnt,
   *    sonst käme nur Zeichenmüll beim Modell an.
   *  - Pro Datei und insgesamt gilt ein Zeichenlimit (siehe Konstanten).
   *
   * Hinweise für den Nutzer sammeln sich in `notices` und erscheinen gebündelt.
   */
  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const notices: string[] = [];
    const accepted: AttachedFile[] = [];

    // Schon angehängte Zeichen zählen mit, damit das Gesamtlimit stimmt.
    let totalChars = attachedFiles.reduce(
      (total, file) => total + file.content.length,
      0
    );

    for (const file of Array.from(fileList)) {
      if (file.type.startsWith('image/')) {
        notices.push(
          `${file.name}: Bilder werden momentan nicht als Textdatei verarbeitet.`
        );
        continue;
      }

      let originalContent: string;

      try {
        originalContent = await file.text();
      } catch {
        notices.push(`Die Datei ${file.name} konnte nicht gelesen werden.`);
        continue;
      }

      if (originalContent.includes('\u0000')) {
        notices.push(`${file.name} ist keine Textdatei und wurde übersprungen.`);
        continue;
      }

      const content = originalContent.slice(0, FILE_MAX_CHARS);

      if (totalChars + content.length > TOTAL_FILE_MAX_CHARS) {
        notices.push(
          `Die Dateien dürfen zusammen höchstens ` +
            `${TOTAL_FILE_MAX_CHARS.toLocaleString('de-DE')} Zeichen enthalten ` +
            `(${file.name} wurde nicht angehängt).`
        );
        continue;
      }

      const truncated = originalContent.length > FILE_MAX_CHARS;

      if (truncated) {
        notices.push(
          `${file.name} wurde auf ${FILE_MAX_CHARS.toLocaleString('de-DE')} Zeichen begrenzt.`
        );
      }

      totalChars += content.length;
      accepted.push({ name: file.name, content, size: file.size, truncated });
    }

    if (accepted.length > 0) {
      setAttachedFiles((previousFiles) => [...previousFiles, ...accepted]);
    }

    setErrorMessage(notices.join(' '));
  };

  /** Entfernt eine angehängte Datei wieder (vor dem Senden). */
  const removeFile = (index: number) => {
    setAttachedFiles((previousFiles) =>
      previousFiles.filter((_, fileIndex) => fileIndex !== index)
    );
  };

  // ---------------------------------------------------------------------------
  // Verbindungstest der API-Keys
  // ---------------------------------------------------------------------------

  /**
   * Ruft /api/health auf. Der Server prüft dort jeden eingetragenen Key und
   * liefert zurück, welcher Key funktioniert und was der Anbieter sonst meldet.
   *
   * normal: nur Lese-Abfragen, kostenlos. Prüft, ob der Key GÜLTIG ist.
   * deep:   zusätzlich eine winzige echte Anfrage bei OpenAI und Google. Nur so
   *         sieht man, ob noch Guthaben/Kontingent da ist. Verbraucht minimal.
   */
  const checkKeys = async (mode: 'normal' | 'deep') => {
    setCheckingMode(mode);

    try {
      const response = await fetch(
        mode === 'deep' ? '/api/health?deep=1' : '/api/health'
      );

      if (!response.ok) {
        throw new Error('Der Verbindungstest ist fehlgeschlagen.');
      }

      setKeyResults((await response.json()) as KeyCheckResult[]);
    } catch (checkError) {
      console.error('Verbindungstest fehlgeschlagen:', checkError);
      setErrorMessage('Der Verbindungstest ist fehlgeschlagen.');
    } finally {
      setCheckingMode(null);
    }
  };

  // Drag-and-drop: Die drei Handler sitzen am äußersten Element der Seite.

  /** Datei wird über das Fenster gezogen: Overlay einblenden. */
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  /**
   * Datei verlässt das Fenster: Overlay ausblenden.
   * dragleave feuert auch, wenn die Maus nur auf ein Kind-Element wechselt.
   * Das wird hier herausgefiltert, sonst flackerte das Overlay.
   */
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    setIsDragging(false);
  };

  /** Datei wird losgelassen: einlesen. */
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    void handleFileUpload(event.dataTransfer.files);
  };

  // ---------------------------------------------------------------------------
  // Diktieren (Spracherkennung des Browsers)
  // ---------------------------------------------------------------------------

  /**
   * Schaltet die Spracherkennung ein oder aus. Der erkannte Text wird an das
   * Eingabefeld angehängt. Nicht jeder Browser unterstützt das (Chrome und Edge
   * ja, Firefox nein), dann erscheint eine Meldung.
   */
  const toggleSpeechRecognition = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMessage(
        'Spracherkennung wird von diesem Browser nicht unterstützt.'
      );
      return;
    }

    // Läuft sie schon, wird sie beendet.
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = 'de-DE';
    recognition.continuous = false; // nach einem Satz automatisch aufhören
    recognition.interimResults = false; // nur das endgültige Ergebnis liefern

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;

      setErrorMessage('Bei der Spracherkennung ist ein Fehler aufgetreten.');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;

      setInput((previousInput) =>
        previousInput ? `${previousInput} ${transcript}` : transcript
      );
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  // ---------------------------------------------------------------------------
  // Senden
  // ---------------------------------------------------------------------------

  /**
   * Baut den Text, der an den Server geht: Eingabetext plus Dateiinhalte.
   *
   * Ergebnis mit Dateien (Beispiel):
   *   Fasse das zusammen
   *
   *   [Angehängte Dateien]
   *
   *   --- Datei: a.txt ---
   *   ...Inhalt...
   *   --- Ende der Datei ---
   *
   * Der Marker "[Angehängte Dateien]" erkennt splitAttachments() später wieder,
   * um die Dateien in der Anzeige als kleine Chips zu zeigen.
   */
  const buildPrompt = () => {
    const currentInput = input.trim();

    if (attachedFiles.length === 0) {
      return currentInput;
    }

    const fileContext = attachedFiles
      .map((file) => {
        const truncatedNotice = file.truncated
          ? '\n[Hinweis: Diese Datei wurde gekürzt.]\n'
          : '';

        return (
          `\n--- Datei: ${file.name} ---\n` +
          `${truncatedNotice}` +
          `${file.content}\n` +
          `--- Ende der Datei ---`
        );
      })
      .join('\n');

    return [currentInput, ATTACHMENT_MARKER, fileContext]
      .filter(Boolean)
      .join('\n\n');
  };

  /**
   * Wird beim Absenden des Formulars aufgerufen (Enter oder Senden-Button).
   * Während einer laufenden Antwort und bei leerer Eingabe passiert nichts.
   */
  const submitMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    // Verhindert, dass der Browser die Seite neu lädt (Standardverhalten von Formularen).
    event.preventDefault();

    if (isLoading) {
      return;
    }

    const prompt = buildPrompt();

    if (!prompt.trim()) {
      return;
    }

    setErrorMessage('');
    clearError();
    setInput('');
    setAttachedFiles([]);

    // `body` wird zusätzlich zu den Nachrichten an /api/chat geschickt:
    // Modell (welcher Anbieter?) und Chat-ID (wohin speichern?).
    // Fehler landen im `error`-State von useChat und werden unten angezeigt.
    await sendMessage(
      { text: prompt },
      { body: { model: selectedModel, chatId } }
    );
  };

  // ---------------------------------------------------------------------------
  // Die sichtbare Oberfläche (JSX)
  // ---------------------------------------------------------------------------
  return (
    // Äußerster Rahmen. Hier hängen die Drag-and-drop-Handler.
    <div
      className="relative flex h-dvh overflow-hidden bg-zinc-950 font-sans text-zinc-100"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Overlay "Dateien hier ablegen", nur während des Ziehens sichtbar.
          pointer-events-none: es fängt keine Mausereignisse ab, sonst würde
          dragleave ständig feuern. */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 m-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-500 bg-zinc-900/90 backdrop-blur-sm">
          <Paperclip className="mb-2 h-12 w-12 animate-bounce text-zinc-400" />

          <p className="text-lg font-medium text-zinc-200">
            Dateien hier ablegen
          </p>
        </div>
      )}

      {/* ------------------------- Seitenleiste ------------------------- */}
      <aside className="flex w-72 shrink-0 flex-col justify-between border-r border-zinc-800 bg-zinc-900 p-4">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-5 w-5 text-indigo-400" />

            <span>AI Platform 2026</span>
          </div>

          <button
            type="button"
            onClick={createNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700/50 bg-zinc-800 px-4 py-2.5 text-sm font-medium transition hover:bg-zinc-700/80"
          >
            <Plus className="h-4 w-4" />
            Neuer Chat
          </button>

          {/* Modell-Filter + Dropdown */}
<div className="mt-2 flex flex-col gap-2">
  <div className="flex items-center justify-between">
    <label
      htmlFor="model-select"
      className="text-xs font-semibold uppercase tracking-wider text-zinc-400"
    >
      Modell wählen
    </label>

    <button
      type="button"
      onClick={() => {
        const nextOnlyFree = !onlyFree;
        setOnlyFree(nextOnlyFree);

        if (nextOnlyFree) {
          const current = MODELS.find((m) => m.key === selectedModel);
          if (current && !current.isFree) {
            setSelectedModel(DEFAULT_MODEL);
          }
        }
      }}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
        onlyFree
          ? 'bg-emerald-900/60 text-emerald-300 ring-1 ring-emerald-700/50'
          : 'bg-amber-900/40 text-amber-300 ring-1 ring-amber-700/40'
      }`}
      title={
        onlyFree
          ? 'Nur Free-/Limit-Modelle'
          : 'Alle Modelle inkl. bezahlter'
      }
    >
      {onlyFree ? '🆓 Free' : '💰 Alle'}
    </button>
  </div>

  <select
    id="model-select"
    value={selectedModel}
    onChange={(event) => {
      setSelectedModel(event.target.value as ModelKey);
      setErrorMessage('');
      clearError();
    }}
    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-700"
  >
    {modelGroups.map(({ group, models }) => (
      <optgroup key={group} label={group}>
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {model.isFree ? '🆓 ' : '💰 '}
            {model.label}
          </option>
        ))}
      </optgroup>
    ))}
  </select>

  <p className="text-[10px] leading-tight text-zinc-500">
    {onlyFree
      ? 'Nur Modelle mit Free-Tier / Rate-Limits'
      : 'Bezahlte Modelle (z. B. OpenAI) verbrauchen Guthaben'}
  </p>
</div>

          {/* Chatverlauf */}
          <div className="mt-4 flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
            <span className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Verlauf
            </span>

            {chats.length === 0 ? (
              <p className="py-2 text-xs text-zinc-500">
                Keine vergangenen Chats
              </p>
            ) : (
              chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center justify-between rounded-lg text-xs transition ${
                    chatId === chat.id
                      ? 'bg-zinc-800 font-medium text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void loadChat(chat.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />

                    <span className="truncate">
                      {chat.title || 'Neuer Chat'}
                    </span>
                  </button>

                  {/* Papierkorb: nur beim Darüberfahren oder per Tastatur sichtbar */}
                  <button
                    type="button"
                    onClick={(event) => void deleteChat(chat.id, event)}
                    className="mr-2 p-1 opacity-0 transition hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                    title="Chat löschen"
                    aria-label="Chat löschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Unterer Rand: Verbindungstest und aktives Modell */}
        <div className="flex flex-col gap-3 border-t border-zinc-800 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void checkKeys('normal')}
              disabled={isCheckingKeys}
              title="Prüft, ob die Keys gültig sind (kostenlos)"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-60"
            >
              {checkingMode === 'normal' ? 'Prüfe...' : 'Keys prüfen'}
            </button>

            <button
              type="button"
              onClick={() => void checkKeys('deep')}
              disabled={isCheckingKeys}
              title="Schickt eine winzige echte Anfrage an OpenAI und Google und zeigt, ob noch Guthaben/Kontingent da ist (verbraucht minimal)"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-60"
            >
              {checkingMode === 'deep' ? 'Teste...' : 'Guthaben testen'}
            </button>
          </div>

          {/* Ergebnisliste: grün = Key gültig, rot = Fehler mit Meldung des Anbieters */}
          {keyResults && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-[11px] leading-snug">
              {keyResults.map((result) => (
                <li
                  key={`${result.provider}-${result.keyName}`}
                  className="flex gap-1.5"
                >
                  {result.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  )}

                  <span className={result.ok ? 'text-zinc-300' : 'text-zinc-400'}>
                    <span className="font-medium text-zinc-200">
                      {result.provider}
                    </span>{' '}
                    <span className="text-zinc-500">({result.keyName})</span>
                    <br />
                    {result.message}
                    {result.status ? ` [${result.status}]` : ''}
                    {result.hint && (
                      <span className="mt-1 block text-amber-300/90">
                        {result.hint}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Aktives Modell:
            </p>

            <p className="truncate text-xs text-zinc-300">
              {selectedModelLabel}
            </p>
          </div>
        </div>
      </aside>

      {/* ------------------------- Hauptbereich ------------------------- */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">
        {/* Nachrichtenliste */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {messages.length === 0 ? (
            // Leerer Zustand: Platzhalter
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-zinc-500">
              <Bot className="h-12 w-12 text-zinc-700" />

              <p className="max-w-sm text-sm">
                Starte ein Gespräch, erstelle ein Bild oder ziehe Dokumente
                hinein.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const rawText = getMessageText(message);
              const isUser = message.role === 'user';

              // Nutzer: Text und Dateinamen trennen, damit Dateiinhalte nicht
              // als riesiger Block erscheinen.
              const { text: userText, fileNames } = isUser
                ? splitAttachments(rawText)
                : { text: '', fileNames: [] as string[] };

              // Antwort: enthält sie ein Pollinations-Bild, URL herausholen und
              // das Markdown aus dem sichtbaren Text entfernen.
              const imageUrl = isUser ? null : getImageUrl(rawText);
              const displayText = isUser
                ? userText
                : rawText.replace(IMAGE_MARKDOWN, '').trim();

              // Leere Blasen vermeiden, z. B. solange nur Denkschritte des
              // Modells gestreamt werden und noch kein Text da ist.
              if (!displayText && !imageUrl && fileNames.length === 0) {
                return null;
              }

              return (
                <div
                  key={message.id}
                  className={`mx-auto flex max-w-4xl gap-4 ${
                    isUser ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {!isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-600/20">
                      <Bot className="h-4 w-4 text-indigo-400" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      isUser
                        ? 'rounded-br-none bg-indigo-600 text-white'
                        : 'rounded-bl-none border border-zinc-800 bg-zinc-900 text-zinc-200'
                    }`}
                  >
                    {displayText}

                    {/* Angehängte Dateien als kleine Chips */}
                    {fileNames.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {fileNames.map((name, index) => (
                          <span
                            key={`${name}-${index}`}
                            className="flex items-center gap-1 rounded-md bg-indigo-500/40 px-2 py-0.5 text-xs"
                          >
                            <FileText className="h-3 w-3" />
                            {name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Erzeugtes Bild (mit automatischer Wiederholung) */}
                    {imageUrl && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-zinc-400">
                          Generiertes Bild:
                        </p>

                        <GeneratedImage url={imageUrl} />
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800">
                      <User className="h-4 w-4 text-zinc-300" />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* "Antwort wird generiert ..." zwischen Senden und erstem Text */}
          {status === 'submitted' && (
            <div className="mx-auto flex max-w-4xl items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-600/20">
                <Bot className="h-4 w-4 text-indigo-400" />
              </div>

              <div className="animate-pulse text-xs text-zinc-500">
                Antwort wird generiert...
              </div>
            </div>
          )}

          {/* Fehlermeldung: eigene Meldung oder Fehler des Anbieters */}
          {shownError && (
            <div className="mx-auto max-w-4xl rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {shownError}
            </div>
          )}

          {/* Unsichtbarer Anker, zu dem automatisch gescrollt wird */}
          <div ref={messagesEndRef} />
        </div>

        {/* Eingabebereich */}
        <div className="border-t border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur-md">
          <form
            onSubmit={submitMessage}
            className="mx-auto max-w-4xl space-y-2"
          >
            {/* Angehängte Dateien vor dem Senden, einzeln entfernbar */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300"
                  >
                    <FileText className="h-3.5 w-3.5 text-indigo-400" />

                    <span className="max-w-[180px] truncate">{file.name}</span>

                    {file.truncated && (
                      <span className="text-yellow-500">gekürzt</span>
                    )}

                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="ml-1 transition hover:text-red-400"
                      title="Datei entfernen"
                      aria-label="Datei entfernen"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative flex items-center">
              {/* Verstecktes Datei-Eingabefeld, das der Büroklammer-Button öffnet.
                  Danach wird der Wert geleert, damit dieselbe Datei erneut
                  gewählt werden kann. */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void handleFileUpload(event.target.files);
                  event.target.value = '';
                }}
              />

              {/* Buttons links im Eingabefeld: Datei anhängen und Diktieren */}
              <div className="absolute left-3 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                  title="Datei anhängen"
                  aria-label="Datei anhängen"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={toggleSpeechRecognition}
                  className={`rounded-lg p-1.5 transition ${
                    isListening
                      ? 'animate-pulse bg-red-950/50 text-red-400'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                  title="Diktieren"
                  aria-label="Diktieren"
                >
                  {isListening ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Texteingabe. Der Platzhalter passt sich Modell und Diktiermodus an. */}
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  isListening
                    ? 'Höre zu... Sprich jetzt...'
                    : isImageModel
                      ? 'Beschreibe das Bild...'
                      : 'Frage stellen, Datei reinziehen oder diktieren...'
                }
                className={`w-full rounded-xl border bg-zinc-900 py-3 pl-20 pr-12 text-sm text-zinc-100 outline-none transition ${
                  isListening
                    ? 'border-red-500/50'
                    : 'border-zinc-800 focus:border-zinc-700'
                }`}
              />

              {/* Rechts: während der Antwort "Stopp", sonst "Senden" */}
              {isLoading ? (
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="absolute right-2 rounded-lg bg-zinc-700 p-2 text-white transition hover:bg-zinc-600"
                  title="Antwort stoppen"
                  aria-label="Antwort stoppen"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && attachedFiles.length === 0}
                  className="absolute right-2 rounded-lg bg-indigo-600 p-2 text-white transition hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600"
                  title="Nachricht senden"
                  aria-label="Nachricht senden"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
