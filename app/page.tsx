/**
 * app/page.tsx
 * =============================================================================
 * Vollständige Chat-Oberfläche inkl. Responsive-Support (600px - 1200px)
 * und integriertem Panel für autonome KI-Agenten.
 * =============================================================================
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

import {
  Bot,
  CheckCircle2,
  Cpu,
  FileText,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  Terminal,
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

interface ChatItem {
  id: string;
  title: string;
  created_at: string;
}

interface StoredChatMessage {
  id: string;
  role: string;
  content: string;
}

interface KeyCheckResult {
  provider: string;
  keyName: string;
  configured: boolean;
  ok: boolean;
  status: number | null;
  message: string;
  hint?: string;
}

interface AttachedFile {
  name: string;
  content: string;
  size: number;
  truncated: boolean;
}

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

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

// =============================================================================
// 2. Konstanten
// =============================================================================

const FILE_MAX_CHARS = 30_000;
const TOTAL_FILE_MAX_CHARS = 80_000;

const IMAGE_MARKDOWN =
  /!\[[^\]]*\]\((https:\/\/image\.pollinations\.ai\/[^)\s]+)\)/;

const transport = new DefaultChatTransport({ api: '/api/chat' });

function createChatId() {
  return `chat-${crypto.randomUUID()}`;
}

function getImageUrl(text: string): string | null {
  return text.match(IMAGE_MARKDOWN)?.[1] ?? null;
}

// =============================================================================
// 3. GeneratedImage
// =============================================================================

function GeneratedImage({ url }: { url: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const autoRetried = useRef(false);

  const src = attempt === 0 ? url : `${url}&retry=${attempt}`;

  const handleError = () => {
    if (!autoRetried.current) {
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
  const [selectedModel, setSelectedModel] = useState<ModelKey>(DEFAULT_MODEL);
  const [onlyFree, setOnlyFree] = useState(true);
  const [chatId, setChatId] = useState(createChatId);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [keyResults, setKeyResults] = useState<KeyCheckResult[] | null>(null);
  const [checkingMode, setCheckingMode] = useState<'normal' | 'deep' | null>(
    null
  );

  // Responsive Drawer-State (600px - 1200px)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // KI-Agent State
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [agentTab, setAgentTab] = useState<'logs' | 'tools'>('logs');

  const isCheckingKeys = checkingMode !== null;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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

  const { messages, sendMessage, status, setMessages, stop, error, clearError } =
    useChat<UIMessage>({
      transport,
      onFinish: () => {
        void fetchChats();
      },
    });

  const isLoading = status === 'submitted' || status === 'streaming';
  const isImageModel = selectedModel === IMAGE_MODEL;
  const selectedModelDef = MODELS.find((model) => model.key === selectedModel);
  const selectedModelLabel = selectedModelDef?.label ?? '';
  const modelGroups = getModelGroups(onlyFree);
  const shownError = errorMessage || error?.message || '';

  // Chatliste beim Start laden
  useEffect(() => {
    void fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  // Escape schließt Sidebar-Drawer und Agent-Panel
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSidebarOpen(false);
        setIsAgentOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const resetComposer = () => {
    setInput('');
    setAttachedFiles([]);
    setErrorMessage('');
    clearError();
  };

  const loadChat = async (id: string) => {
    try {
      void stop();
      setErrorMessage('');
      clearError();
      setIsSidebarOpen(false); // Schließt Drawer auf Tablets/Mobilgeräten

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

  const createNewChat = () => {
    void stop();
    setChatId(createChatId());
    setMessages([]);
    resetComposer();
    setIsSidebarOpen(false); // Schließt Drawer auf Tablets/Mobilgeräten
  };

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
      if (chatId === id) {
        createNewChat();
      }
    } catch (deleteError) {
      console.error('Fehler beim Löschen des Chats:', deleteError);
      setErrorMessage('Der Chat konnte nicht gelöscht werden.');
    }
  };

  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const notices: string[] = [];
    const accepted: AttachedFile[] = [];
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
          `Die Dateien dürfen zusammen höchstens ${TOTAL_FILE_MAX_CHARS.toLocaleString('de-DE')} Zeichen enthalten (${file.name} wurde nicht angehängt).`
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

  const removeFile = (index: number) => {
    setAttachedFiles((previousFiles) =>
      previousFiles.filter((_, fileIndex) => fileIndex !== index)
    );
  };

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

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

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

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFileUpload(event.dataTransfer.files);
  };

  const toggleSpeechRecognition = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMessage(
        'Spracherkennung wird von diesem Browser nicht unterstützt.'
      );
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
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

  const buildPrompt = () => {
    const currentInput = input.trim();
    if (attachedFiles.length === 0) return currentInput;

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

  const submitMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;

    const prompt = buildPrompt();
    if (!prompt.trim()) return;

    setErrorMessage('');
    clearError();
    setInput('');
    setAttachedFiles([]);

    await sendMessage(
      { text: prompt },
      { body: { model: selectedModel, chatId } }
    );
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    // Äußerster Rahmen. Hier hängen die Drag-and-drop-Handler.
    <div
      className="relative flex h-dvh overflow-hidden bg-zinc-950 font-sans text-zinc-100"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Overlay "Dateien hier ablegen", nur während des Ziehens sichtbar. */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-[60] m-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-500 bg-zinc-900/90 backdrop-blur-sm">
          <Paperclip className="mb-2 h-12 w-12 animate-bounce text-zinc-400" />
          <p className="text-lg font-medium text-zinc-200">
            Dateien hier ablegen
          </p>
        </div>
      )}

      {/* ============================================================
           1. RESPONSIVE SEITENLEISTE (Sidebar / Drawer)
           - Desktop (≥1280px / xl): immer sichtbar, fest im Layout
           - Tablet & Mobile (< 1280px): fixed Drawer, per Hamburger
             ein-/ausklappbar, schließt bei Chat-Auswahl automatisch
           ============================================================ */}

      {/* Backdrop: MUSS außerhalb der <aside> stehen. Ein transformiertes
          Elternelement macht "fixed" sonst relativ zu sich selbst, und der
          Backdrop würde nur die Sidebar statt den ganzen Bildschirm abdecken. */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm xl:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col justify-between border-r border-zinc-800 bg-zinc-900 p-4 transition-transform duration-300 ease-in-out xl:static xl:z-auto xl:translate-x-0 xl:shadow-none ${
          isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
        aria-label="Chat-Verlauf und Einstellungen"
      >
        <div className="flex min-h-0 flex-col gap-4">
          {/* Header: Logo + Schließen (nur < xl) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-lg font-bold">
              <Sparkles className="h-5 w-5 text-indigo-400" />
              <span>AI Platform 2026</span>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden"
              aria-label="Seitenleiste schließen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Neuer Chat */}
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
                    onClick={() => {
                      void loadChat(chat.id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {chat.title || 'Neuer Chat'}
                    </span>
                  </button>

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

                  <span
                    className={result.ok ? 'text-zinc-300' : 'text-zinc-400'}
                  >
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

      {/* ============================================================
           2. HAUPTBEREICH (Chat + Eingabe)
           ============================================================ */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">
        {/* Hamburger-Button oben links (nur < xl) */}
        <button
          type="button"
          onClick={() => setIsSidebarOpen(true)}
          className="absolute left-3 top-3 z-20 rounded-lg bg-zinc-900/80 p-2 text-zinc-200 shadow-lg backdrop-blur-sm transition hover:bg-zinc-800 xl:hidden"
          aria-label="Menü öffnen"
          aria-expanded={isSidebarOpen}
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* ------------------------- CHAT-VERLAUF ------------------------- */}
        <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6 lg:p-8">
          {/* Platzhalter, damit der Hamburger-Button keine Nachricht überdeckt */}
          <div className="h-8 shrink-0 xl:hidden" aria-hidden="true" />

          {messages.length === 0 ? (
            // Leerer Zustand
            <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-zinc-500">
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

              // Nutzer: Text und Dateinamen trennen
              const { text: userText, fileNames } = isUser
                ? splitAttachments(rawText)
                : { text: '', fileNames: [] as string[] };

              // Antwort: Bild-URL extrahieren & Markdown entfernen
              const imageUrl = isUser ? null : getImageUrl(rawText);
              const displayText = isUser
                ? userText
                : rawText.replace(IMAGE_MARKDOWN, '').trim();

              // Leere Blasen vermeiden (z. B. Reasoning-Schritte ohne Text)
              if (!displayText && !imageUrl && fileNames.length === 0) {
                return null;
              }

              return (
                <div
                  key={message.id}
                  className={`mx-auto flex max-w-3xl gap-4 ${
                    isUser ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {!isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-600/20">
                      <Bot className="h-4 w-4 text-indigo-400" />
                    </div>
                  )}

                  <div
                    className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed md:max-w-[85%] ${
                      isUser
                        ? 'rounded-br-none bg-indigo-600 text-white'
                        : 'rounded-bl-none border border-zinc-800 bg-zinc-900 text-zinc-200'
                    }`}
                  >
                    {displayText}

                    {/* Angehängte Dateien als Chips */}
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

                    {/* Generiertes Bild (mit Auto-Retry) */}
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

          {/* "Antwort wird generiert …" */}
          {status === 'submitted' && (
            <div className="mx-auto flex max-w-3xl items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-600/20">
                <Bot className="h-4 w-4 text-indigo-400" />
              </div>
              <div className="animate-pulse text-xs text-zinc-500">
                Antwort wird generiert...
              </div>
            </div>
          )}

          {/* Fehlermeldung */}
          {shownError && (
            <div className="mx-auto max-w-3xl rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {shownError}
            </div>
          )}

          {/* Scroll-Anker */}
          <div ref={messagesEndRef} />
        </div>

        {/* ------------------------- EINGABEBEREICH ------------------------- */}
        <div className="border-t border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur-md md:p-6">
          <form onSubmit={submitMessage} className="mx-auto max-w-3xl space-y-2">
            {/* Angehängte Dateien (entfernbar) */}
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
              {/* Verstecktes File-Input */}
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

              {/* Buttons links: Datei + Diktieren */}
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

              {/* Texteingabe */}
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

              {/* Rechts: Stopp oder Senden */}
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

      {/* ============================================================
           3. KI-AGENT PANEL (vorbereitet für spätere Autonomie)
           ============================================================ */}

      {/* Floating Action Button (FAB).
          bottom-28 statt bottom-6, damit er nicht den Senden-Button
          im Eingabefeld überdeckt (vorher auf Tablets/Mobile der Fall). */}
      <button
        type="button"
        onClick={() => setIsAgentOpen((open) => !open)}
        className="fixed bottom-28 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/30 transition hover:scale-105 hover:shadow-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 md:right-6"
        aria-label={isAgentOpen ? 'Agent-Panel schließen' : 'Agent-Panel öffnen'}
        aria-expanded={isAgentOpen}
        title="KI-Agent"
      >
        {isAgentOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Sparkles className="h-6 w-6 animate-pulse" />
        )}
      </button>

      {/* Agent Panel */}
      {isAgentOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsAgentOpen(false)}
            aria-hidden="true"
          />

          {/* Panel (Breite begrenzt, damit es auf kleinen Screens nicht links herausragt) */}
          <div className="fixed bottom-44 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm md:right-6 md:max-w-md lg:max-w-lg">
            <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-2 w-2 animate-pulse rounded-full bg-violet-500" />
                  <span className="text-sm font-semibold text-white">
                    Autonomous Agent
                  </span>
                  <span className="rounded-full bg-violet-500/20 px-2 py-0.5 font-mono text-xs text-violet-300">
                    v0.1.0-alpha
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAgentOpen(false)}
                  className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                  aria-label="Panel schließen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tab-Navigation */}
              <div className="flex border-b border-zinc-800 bg-zinc-900/50">
                {[
                  { id: 'logs', label: 'Logs', icon: Terminal },
                  { id: 'tools', label: 'Tools', icon: Cpu },
                ].map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    onClick={() => setAgentTab(tab.id as 'logs' | 'tools')}
                    className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition ${
                      agentTab === tab.id
                        ? 'border-b-2 border-violet-500 bg-zinc-950 text-violet-400'
                        : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab-Inhalt */}
              <div className="max-h-[50vh] flex-1 space-y-3 overflow-y-auto p-4">
                {agentTab === 'logs' ? (
                  <div className="space-y-2 font-mono text-xs text-zinc-300">
                    <div className="rounded border border-zinc-800/50 bg-zinc-900/50 p-2">
                      <span className="text-zinc-500">[System]</span> Agent
                      initialisiert. Warte auf Trigger...
                    </div>
                    <div className="rounded border border-zinc-800/50 bg-zinc-900/50 p-2">
                      <span className="text-emerald-500">[Ready]</span> Tools
                      geladen: WebSearch, CodeExec, FileRead.
                    </div>
                    <div className="rounded border border-zinc-800/50 bg-zinc-900/50 p-2 opacity-50">
                      <span className="text-zinc-500">[Info]</span> Keine
                      aktiven Tasks. Sende einen Befehl im Chat oder nutze
                      <code className="ml-1 text-violet-400">/agent run</code>{' '}
                      oder wähle ein Tool oben.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs text-zinc-300">
                    <div className="rounded border border-zinc-800/50 bg-zinc-900/50 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-violet-400" />
                        <span className="font-semibold text-white">
                          Verfügbare Tools
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {[
                          {
                            name: 'WebSearch',
                            desc: 'Live-Suche im Internet',
                            icon: '🌐',
                            disabled: false,
                          },
                          {
                            name: 'CodeExec',
                            desc: 'Python/JS Sandbox',
                            icon: '⚙️',
                            disabled: false,
                          },
                          {
                            name: 'FileRead',
                            desc: 'Dateien lesen & analysieren',
                            icon: '📄',
                            disabled: false,
                          },
                          {
                            name: 'Shell',
                            desc: 'Befehle ausführen (geplant)',
                            icon: '💻',
                            disabled: true,
                          },
                        ].map((tool) => (
                          <li
                            key={tool.name}
                            className="flex items-center gap-2 rounded border border-zinc-800/50 bg-zinc-900/50 px-2 py-1.5"
                          >
                            <span className="text-lg">{tool.icon}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{tool.name}</p>
                              <p className="truncate text-[10px] text-zinc-500">
                                {tool.desc}
                              </p>
                            </div>
                            {tool.disabled && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                Bald
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}