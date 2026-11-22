/**
 * app/page.tsx
 * =============================================================================
 * Vollständige Chat-Oberfläche inkl. Responsive-Support (600px - 1200px)
 * und integriertem Panel für autonome KI-Agenten.
 * =============================================================================
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Cpu,
  FileText,
  LogOut,
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
  Volume2,
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
  MODELS,
  getModelGroups,
  type ModelDefinition,
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

// =============================================================================
// 2. Konstanten
// =============================================================================

const FILE_MAX_CHARS = 30_000;
const TOTAL_FILE_MAX_CHARS = 80_000;

const IMAGE_MARKDOWN =
  /!\[[^\]]*\]\(((?:https:\/\/image\.pollinations\.ai|\/api\/images)\/[^)\s]+)\)/;

// Bilder/Videos nur in der letzten Nachricht mitschicken (sonst sprengt der Verlauf das Größenlimit)
const transport = new DefaultChatTransport<UIMessage>({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => {
    const lastIndex = messages.length - 1;
    const slimMessages = messages.map((message, index) =>
      index === lastIndex
        ? message
        : { ...message, parts: message.parts.filter((part) => part.type !== 'file') }
    );
    return { body: { ...body, id, messages: slimMessages, trigger, messageId } };
  },
});

// Design-Vorlagen (Farben stehen in globals.css) und Vorlese-Einstellungen
const THEMES = [
  { key: 'standard', label: 'Dunkel (Standard)' },
  { key: 'mitternacht', label: 'Mitternacht (Blau)' },
  { key: 'wald', label: 'Wald (Grün)' },
  { key: 'sonnenuntergang', label: 'Sonnenuntergang (Gelb → Orange)' },
  { key: 'hell', label: 'Weiße Blindheit' },
];
const TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Zephyr', 'Orus'];
const TTS_MAX_CHARS = 2500;

/** Macht aus einer Antwort einen sprechbaren Text (ohne Code, Links und Formatzeichen). */
function toSpeechText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?(```|$)/g, ' Codeblock. ')
    .replace(/https?:\/\/\S+/g, ' Link. ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Teilt den Text in Häppchen: ein kurzes erstes (schnell hörbar), danach größere. */
function splitForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const limit = chunks.length === 0 ? 220 : 700;
    if (current && (current + sentence).length > limit) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function SpeakButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? 'Vorlesen stoppen' : 'Vorlesen'}
      className="group/copy relative rounded-md p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
    >
      {active ? (
        <Square className="h-3.5 w-3.5 text-amber-300" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
      <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1 whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-normal text-zinc-200 opacity-0 shadow transition group-hover/copy:opacity-100">
        {active ? 'Stopp' : 'Vorlesen'}
      </span>
    </button>
  );
}

// Schnellstart-Aufträge für den GitHub-Agent (laufen im Nur-Lesen-Modus)
const AGENT_PRESETS = [
  {
    label: 'Repo durchschauen',
    prompt:
      'Schau dir das Repository an, ohne etwas zu ändern. Nutze listFiles und lies dann package.json sowie die wichtigsten Dateien in app/ und lib/. Berichte: 1) Aufbau in fünf Sätzen, 2) mögliche Fehler oder Lücken mit Dateiname, 3) Verbesserungsvorschläge. Ändere nichts.',
  },
  {
    label: 'Dateiliste erklären',
    prompt:
      'Liste alle Dateien im Repo auf und erkläre in je einem Satz, wofür die wichtigsten da sind. Ändere nichts.',
  },
  {
    label: 'Letzte Änderungen',
    prompt:
      'Zeige mit fileHistory die letzten Commits der Datei app/page.tsx und fasse zusammen, was zuletzt geändert wurde. Ändere nichts.',
  },
];

// Bilder und Videos als Anhang
const VIDEO_MAX_BYTES = 3_000_000;
const MEDIA_MAX_CHARS = 3_500_000;
const MAX_MEDIA_COUNT = 4;

interface AttachedMedia {
  name: string;
  mediaType: string;
  url: string;
}

/** Verkleinert ein Bild auf maximal 1280 Pixel (JPEG) und gibt eine Data-URL zurück. */
async function imageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas nicht verfügbar');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface FilePartInfo {
  key: string;
  mediaType: string;
  url: string;
  name: string;
}

function getFileParts(message: UIMessage): FilePartInfo[] {
  const parts = (message.parts ?? []) as unknown as Array<Record<string, unknown>>;
  return parts
    .filter(
      (p) =>
        p.type === 'file' &&
        typeof p.url === 'string' &&
        typeof p.mediaType === 'string'
    )
    .map((p, index) => ({
      key: String(index),
      mediaType: p.mediaType as string,
      url: p.url as string,
      name: typeof p.filename === 'string' ? p.filename : 'Anhang',
    }));
}

function getSourceParts(
  message: UIMessage
): { key: string; url: string; title: string }[] {
  const parts = (message.parts ?? []) as unknown as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const result: { key: string; url: string; title: string }[] = [];

  for (const part of parts) {
    if (
      part.type === 'source-url' &&
      typeof part.url === 'string' &&
      /^https?:\/\//.test(part.url) &&
      !seen.has(part.url)
    ) {
      seen.add(part.url);
      result.push({
        key: part.url,
        url: part.url,
        title: typeof part.title === 'string' && part.title ? part.title : part.url,
      });
    }
  }
  return result.slice(0, 8);
}

function MediaThumb({
  mediaType,
  url,
  name,
  className,
  controls = false,
}: {
  mediaType: string;
  url: string;
  name: string;
  className: string;
  controls?: boolean;
}) {
  if (mediaType.startsWith('video/')) {
    return <video src={url} controls={controls} muted={!controls} className={className} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} className={className} />
    </>
  );
}

function createChatId() {
  return `chat-${crypto.randomUUID()}`;
}

function getImageUrl(text: string): string | null {
  return text.match(IMAGE_MARKDOWN)?.[1] ?? null;
}

// Agent-Werkzeugaufrufe (AI SDK v5: Part-Typ "tool-<name>") für die Anzeige
interface ToolPartInfo {
  key: string;
  name: string;
  detail: string;
  status: 'running' | 'done' | 'failed';
}

function getToolParts(message: UIMessage): ToolPartInfo[] {
  const parts = (message.parts ?? []) as unknown as Array<
    Record<string, unknown>
  >;

  return parts
    .filter((p) => typeof p.type === 'string' && p.type.startsWith('tool-'))
    .map((p, index) => {
      const input = (p.input ?? {}) as Record<string, unknown>;
      const output = p.output as Record<string, unknown> | undefined;
      const detail =
        typeof input.path === 'string'
          ? input.path
          : typeof input.query === 'string'
            ? input.query
            : typeof input.prefix === 'string'
              ? input.prefix
              : '';
      const failed = p.state === 'output-error' || output?.ok === false;
      const done = p.state === 'output-available';

      return {
        key: String(p.toolCallId ?? index),
        name: String(p.type).slice(5),
        detail,
        status: failed ? 'failed' : done ? 'done' : 'running',
      } satisfies ToolPartInfo;
    });
}

// =============================================================================
// 3. GeneratedImage
// =============================================================================

function GeneratedImage({ url }: { url: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const autoRetried = useRef(false);

  const src =
    attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;

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

// =============================================================================
// 3b. Kopieren-Button, Codeblöcke, einfache Markdown-Darstellung (ohne Pakete)
// =============================================================================

function CopyButton({
  text,
  label = 'Kopieren',
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Zwischenablage nicht verfügbar */
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      className="group/copy relative rounded-md p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1 whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-normal text-zinc-200 opacity-0 shadow transition group-hover/copy:opacity-100">
        {copied ? 'Kopiert' : label}
      </span>
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const lineCount = code.split('\n').length;
  // Lange Blöcke (z. B. aus dem Verlauf) starten eingeklappt, kurze offen.
  // Der Startwert gilt nur beim ersten Anzeigen, ein streamender Block bleibt
  // also offen, bis du ihn selbst einklappst.
  const [open, setOpen] = useState(lineCount <= 15);
  const isLong = lineCount > 12;

  return (
    <div className="my-2 rounded-lg border border-zinc-700 bg-zinc-950">
      <div
        className={`flex items-center justify-between bg-zinc-900 px-3 py-1 text-[11px] text-zinc-400 ${
          open ? 'rounded-t-lg border-b border-zinc-800' : 'rounded-lg'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1.5 transition hover:text-zinc-200"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              open ? '' : '-rotate-90'
            }`}
          />
          <span>{lang || 'code'}</span>
          <span className="text-zinc-600">
            · {lineCount} {lineCount === 1 ? 'Zeile' : 'Zeilen'}
          </span>
        </button>
        <CopyButton text={code} />
      </div>

      {open && (
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-zinc-200">
          <code>{code}</code>
        </pre>
      )}

      {open && isLong && (
        <div className="flex justify-end rounded-b-lg border-t border-zinc-800 bg-zinc-900 px-3 py-1">
          <CopyButton text={code} />
        </div>
      )}
    </div>
  );
}

function ExternalLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-indigo-300 underline decoration-indigo-300/40 transition hover:text-indigo-200"
    >
      {label}
    </a>
  );
}

function InlineText({ text }: { text: string }) {
  // fett, Code, [Text](https://…) und lose https://…-Adressen
  const parts = text.split(
    /(\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>()[\]]+)/g
  );

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, index) => {
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={index}
              className="rounded bg-zinc-800 px-1 py-0.5 text-[0.85em] text-indigo-300"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        const markdownLink = part.match(/^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (markdownLink) {
          return <ExternalLink key={index} url={markdownLink[2]} label={markdownLink[1]} />;
        }
        if (/^https?:\/\//.test(part)) {
          const url = part.replace(/[.,;:!?]+$/, '');
          return (
            <span key={index}>
              <ExternalLink url={url} label={url} />
              {part.slice(url.length)}
            </span>
          );
        }
        return part;
      })}
    </span>
  );
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'code'; lang: string; value: string };

function RichText({ text }: { text: string }) {
  const segments: Segment[] = [];
  // Auch ein noch nicht geschlossener Codeblock (beim Streaming) wird erkannt
  const regex = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'text', value: text.slice(last, match.index) });
    }
    segments.push({
      type: 'code',
      lang: match[1].trim(),
      value: match[2].replace(/\n$/, ''),
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last) });
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'code') {
          return <CodeBlock key={index} code={segment.value} lang={segment.lang} />;
        }
        const value = segment.value.replace(/^\n+|\n+$/g, '');
        return value ? <InlineText key={index} text={value} /> : null;
      })}
    </>
  );
}

export default function Home() {
  const [selectedModel, setSelectedModel] = useState<ModelKey>(DEFAULT_MODEL);
  const [onlyFree, setOnlyFree] = useState(true);
  const [chatId, setChatId] = useState(createChatId);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
  const [keysOpen, setKeysOpen] = useState(true);
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
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [canAgent, setCanAgent] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [agentWrite, setAgentWrite] = useState(false);
  const [theme, setTheme] = useState('standard');
  const [ttsEngine, setTtsEngine] = useState<'gemini' | 'browser'>('gemini');
  const [ttsVoice, setTtsVoice] = useState('Kore');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakTokenRef = useRef(0);
  const [ttsVolume, setTtsVolume] = useState(0.8);
  const ttsVolumeRef = useRef(0.8);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const isCheckingKeys = checkingMode !== null;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setJustFinished(true);
      },
    });

  const isLoading = status === 'submitted' || status === 'streaming';
  const isImageModel =
    MODELS.find((model) => model.key === selectedModel)?.provider === 'image';
  const selectedModelDef = MODELS.find((model) => model.key === selectedModel);
  const selectedModelLabel = selectedModelDef?.label ?? '';
  const selectedCaps = selectedModelDef as ModelDefinition | undefined;
  const mediaNeedsVideo = attachedMedia.some((media) =>
    media.mediaType.startsWith('video/')
  );
  const mediaUnsupported =
    attachedMedia.length > 0 &&
    !(mediaNeedsVideo ? selectedCaps?.video : selectedCaps?.vision);
  const modelGroups = getModelGroups(onlyFree);
  const shownError = errorMessage || error?.message || '';

  // Login prüfen; ohne Anmeldung geht es zur Login-Seite
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          router.replace('/login');
          return;
        }
        const data = (await response.json()) as {
          email: string;
          canAgent?: boolean;
          isAdmin?: boolean;
        };
        setUserEmail(data.email);
        setCanAgent(data.canAgent === true);
        setIsAdminUser(data.isAdmin === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  // Chatliste beim Start laden
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

    return () => {
      cancelled = true;
    };
  }, []);

  // Nur mitscrollen, solange der Nutzer unten ist. Wer hochscrollt (z. B. zum
  // Kopieren), wird nicht mehr nach unten gezogen.
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, status]);

  const handleChatScroll = () => {
    const element = scrollContainerRef.current;
    if (!element) return;
    stickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  };

  // Tab-Titel zeigt, wann die Antwort fertig ist (auch in anderem Tab sichtbar)
  useEffect(() => {
    const base = 'AI Platform 2026';
    document.title = isLoading
      ? `⏳ Arbeitet… – ${base}`
      : justFinished
        ? `✓ Fertig – ${base}`
        : base;
  }, [isLoading, justFinished]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Escape schließt Sidebar-Drawer und Agent-Panel
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSidebarOpen(false);
        setIsAgentOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Gespeicherte Einstellungen (Design, Vorlesen) laden
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('theme');
      const savedEngine = localStorage.getItem('ttsEngine');
      const savedVoice = localStorage.getItem('ttsVoice');
      const savedVolume = Number(localStorage.getItem('ttsVolume'));
      queueMicrotask(() => {
        if (savedTheme) setTheme(savedTheme);
        if (savedEngine === 'gemini' || savedEngine === 'browser') setTtsEngine(savedEngine);
        if (savedVoice && TTS_VOICES.includes(savedVoice)) setTtsVoice(savedVoice);
        if (Number.isFinite(savedVolume) && savedVolume > 0 && savedVolume <= 1) {
          setTtsVolume(savedVolume);
          ttsVolumeRef.current = savedVolume;
        }
      });
    } catch {
      /* Speicher nicht verfügbar */
    }
  }, []);

  const saveSetting = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Speicher nicht verfügbar */
    }
  };

  const changeTheme = (value: string) => {
    setTheme(value);
    if (value === 'standard') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = value;
    }
    saveSetting('theme', value);
  };

  // Vorlesen
  const stopSpeaking = () => {
    speakTokenRef.current += 1;
    const playing = audioRef.current;
    audioRef.current = null;
    if (playing) {
      playing.pause();
      playing.dispatchEvent(new Event('ended')); // weckt die wartende Wiedergabe-Schleife
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speakWithBrowser = (id: string, text: string) => {
    if (!('speechSynthesis' in window)) {
      setErrorMessage('Dieser Browser kann nicht vorlesen.');
      setSpeakingId(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.volume = ttsVolumeRef.current;
    const german = window.speechSynthesis
      .getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith('de'));
    const best =
      german.find((voice) => /natural|neural|online/i.test(voice.name)) ??
      german.find((voice) => /google/i.test(voice.name)) ??
      german[0];
    if (best) utterance.voice = best;
    utterance.onend = () => setSpeakingId((current) => (current === id ? null : current));
    utterance.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(utterance);
  };

  const fetchSpeechAudio = async (text: string): Promise<Blob> => {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: ttsVoice }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? 'KI-Stimme nicht verfügbar.');
    }
    return response.blob();
  };

  const playAudioBlob = (blob: Blob) =>
    new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = ttsVolumeRef.current;
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Wiedergabe fehlgeschlagen.'));
      };
      audio.play().catch(reject);
    });

  const speak = async (id: string, rawText: string) => {
    if (speakingId === id) {
      stopSpeaking();
      return;
    }
    stopSpeaking();

    const text = toSpeechText(rawText).slice(0, TTS_MAX_CHARS);
    if (!text) return;

    const token = speakTokenRef.current;
    setSpeakingId(id);

    if (ttsEngine === 'browser') {
      speakWithBrowser(id, text);
      return;
    }

    // Kurzes erstes Stück: beginnt schnell. Das nächste wird schon geholt, während das erste läuft.
    const chunks = splitForSpeech(text);
    let played = 0;

    try {
      let next = fetchSpeechAudio(chunks[0]);
      next.catch(() => undefined);

      for (let index = 0; index < chunks.length; index++) {
        const blob = await next;
        if (token !== speakTokenRef.current) return;

        if (index + 1 < chunks.length) {
          next = fetchSpeechAudio(chunks[index + 1]);
          next.catch(() => undefined);
        }

        await playAudioBlob(blob);
        if (token !== speakTokenRef.current) return;
        played += 1;
      }

      setSpeakingId((current) => (current === id ? null : current));
    } catch (speakError) {
      if (token !== speakTokenRef.current) return;
      const reason =
        speakError instanceof Error ? speakError.message : 'KI-Stimme nicht verfügbar.';

      if (played === 0) {
        setErrorMessage(`${reason} Es wird die Browser-Stimme benutzt.`);
        speakWithBrowser(id, text);
      } else {
        setErrorMessage(`${reason} Das Vorlesen wurde beendet.`);
        setSpeakingId(null);
      }
    }
  };

  const changeVolume = (value: number) => {
    setTtsVolume(value);
    ttsVolumeRef.current = value;
    if (audioRef.current) audioRef.current.volume = value;
    saveSetting('ttsVolume', String(value));
  };

  // Profil-Fenster schließt bei Klick daneben
  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [profileOpen]);

  const resetComposer = () => {
    setInput('');
    setAttachedFiles([]);
    setAttachedMedia([]);
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
      setAttachedMedia([]);
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
    const acceptedMedia: AttachedMedia[] = [];
    let mediaChars = attachedMedia.reduce((total, media) => total + media.url.length, 0);
    let totalChars = attachedFiles.reduce(
      (total, file) => total + file.content.length,
      0
    );

    for (const file of Array.from(fileList)) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        const isVideo = file.type.startsWith('video/');

        if (attachedMedia.length + acceptedMedia.length >= MAX_MEDIA_COUNT) {
          notices.push(`Es sind höchstens ${MAX_MEDIA_COUNT} Bilder/Videos pro Nachricht möglich.`);
          continue;
        }
        if (isVideo && file.size > VIDEO_MAX_BYTES) {
          notices.push(`${file.name}: Das Video ist zu groß (maximal 3 MB).`);
          continue;
        }

        try {
          const url = isVideo ? await fileToDataUrl(file) : await imageToDataUrl(file);
          if (mediaChars + url.length > MEDIA_MAX_CHARS) {
            notices.push(`${file.name}: Bilder und Videos dürfen zusammen höchstens ca. 3 MB groß sein.`);
            continue;
          }
          mediaChars += url.length;
          acceptedMedia.push({
            name: file.name,
            mediaType: isVideo ? file.type : 'image/jpeg',
            url,
          });
        } catch {
          notices.push(`${file.name} konnte nicht gelesen werden.`);
        }
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
    if (acceptedMedia.length > 0) {
      setAttachedMedia((previousMedia) => [...previousMedia, ...acceptedMedia]);
    }
    setErrorMessage(notices.join(' '));
  };

  const removeMedia = (index: number) => {
    setAttachedMedia((previousMedia) =>
      previousMedia.filter((_, mediaIndex) => mediaIndex !== index)
    );
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
      setKeysOpen(true);
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

  // Aufnahme -> Groq Whisper (versteht auch englische Fachbegriffe in deutschen Sätzen)
  const toggleSpeechRecognition = async () => {
    if (isListening) {
      recorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMessage('Aufnahme wird von diesem Browser nicht unterstützt.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setIsListening(false);

        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (blob.size < 1000) return;

        setIsTranscribing(true);
        try {
          const form = new FormData();
          const extension = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
          form.append('audio', blob, `aufnahme.${extension}`);

          const response = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = (await response.json().catch(() => ({}))) as {
            text?: string;
            error?: string;
          };
          if (!response.ok) {
            throw new Error(data.error ?? 'Die Aufnahme konnte nicht umgewandelt werden.');
          }

          const transcript = data.text ?? '';
          if (transcript) {
            setInput((previousInput) =>
              previousInput ? `${previousInput} ${transcript}` : transcript
            );
          }
        } catch (transcribeError) {
          setErrorMessage(
            transcribeError instanceof Error
              ? transcribeError.message
              : 'Die Aufnahme konnte nicht umgewandelt werden.'
          );
        } finally {
          setIsTranscribing(false);
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setIsListening(true);

      // Sicherheitsgrenze: nach 60 Sekunden automatisch stoppen
      recordTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 60_000);
    } catch {
      setErrorMessage('Zugriff auf das Mikrofon wurde verweigert.');
    }
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
    const mediaToSend = attachedMedia;
    if (!prompt.trim() && mediaToSend.length === 0) return;

    setErrorMessage('');
    clearError();
    setInput('');
    setAttachedFiles([]);
    setAttachedMedia([]);
    setJustFinished(false);
    stickToBottomRef.current = true;

    await sendMessage(
      {
        text: prompt.trim() || 'Beschreibe den Anhang.',
        files: mediaToSend.map((media) => ({
          type: 'file' as const,
          mediaType: media.mediaType,
          url: media.url,
          filename: media.name,
        })),
      },
      {
        body: {
          model: selectedModel,
          chatId,
          agent: isAgentMode && !isImageModel,
          agentMode: agentWrite && isAdminUser ? 'write' : 'read',
        },
      }
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
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50">
              <div className="flex items-center justify-between px-2 py-1 text-[11px] text-zinc-400">
                <button
                  type="button"
                  onClick={() => setKeysOpen((open) => !open)}
                  aria-expanded={keysOpen}
                  className="flex items-center gap-1 transition hover:text-zinc-200"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${keysOpen ? '' : '-rotate-90'}`}
                  />
                  Prüfergebnis ({keyResults.length})
                </button>
                <button
                  type="button"
                  onClick={() => setKeyResults(null)}
                  aria-label="Ergebnis schließen"
                  title="Schließen"
                  className="rounded p-0.5 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {keysOpen && (
                <div className="px-2 pb-2">
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
                </div>
              )}
            </div>
          )}

          {/* Profil-Knopf mit kleinem Pop-up (Einstellungen) */}
          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
              aria-haspopup="dialog"
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-left text-xs transition hover:bg-zinc-800"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600/30 text-indigo-300">
                <User className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-zinc-200">{userEmail || 'Profil'}</span>
                <span className="block text-[10px] text-zinc-500">Profil und Einstellungen</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
                  profileOpen ? '' : 'rotate-180'
                }`}
              />
            </button>

            {profileOpen && (
              <div
                role="dialog"
                aria-label="Profil und Einstellungen"
                className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-[16rem] space-y-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs shadow-2xl"
              >
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Profil
                  </p>
                  <p className="truncate text-zinc-200">{userEmail || 'Nicht angemeldet'}</p>
                </div>

                <label className="block text-zinc-400">
                  <span className="mb-1 block">Design</span>
                  <select
                    value={theme}
                    onChange={(event) => changeTheme(event.target.value)}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-200 outline-none"
                  >
                    {THEMES.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Vorlesen
                  </p>
                  <select
                    value={ttsEngine}
                    onChange={(event) => {
                      const value = event.target.value === 'browser' ? 'browser' : 'gemini';
                      setTtsEngine(value);
                      saveSetting('ttsEngine', value);
                    }}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-200 outline-none"
                  >
                    <option value="gemini">KI-Stimme (Gemini)</option>
                    <option value="browser">Browser-Stimme</option>
                  </select>

                  {ttsEngine === 'gemini' && (
                    <select
                      value={ttsVoice}
                      onChange={(event) => {
                        setTtsVoice(event.target.value);
                        saveSetting('ttsVoice', event.target.value);
                      }}
                      aria-label="Stimme"
                      className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-200 outline-none"
                    >
                      {TTS_VOICES.map((voice) => (
                        <option key={voice} value={voice}>
                          Stimme: {voice}
                        </option>
                      ))}
                    </select>
                  )}

                  <label className="block text-zinc-400">
                    <span className="mb-1 flex justify-between">
                      <span>Lautstärke</span>
                      <span>{Math.round(ttsVolume * 100)} %</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(ttsVolume * 100)}
                      onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                      className="w-full accent-indigo-500"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => void speak('test', 'Hallo! So klingt diese Stimme.')}
                    className="w-full rounded-lg bg-zinc-800 px-2 py-1.5 text-zinc-200 transition hover:bg-zinc-700"
                  >
                    {speakingId === 'test' ? 'Stopp' : 'Stimme testen'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void logout()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 px-2 py-1.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-red-300"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Abmelden
                </button>
              </div>
            )}
          </div>

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
        <div
          ref={scrollContainerRef}
          onScroll={handleChatScroll}
          className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6 lg:p-8"
        >
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

              const toolParts = isUser ? [] : getToolParts(message);
              const fileParts = isUser ? getFileParts(message) : [];
              const sources = isUser ? [] : getSourceParts(message);

              // Leere Blasen vermeiden (z. B. Reasoning-Schritte ohne Text)
              if (
                !displayText &&
                !imageUrl &&
                fileNames.length === 0 &&
                toolParts.length === 0 &&
                fileParts.length === 0
              ) {
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
                    {/* Agent-Werkzeugaufrufe */}
                    {toolParts.length > 0 && (
                      <div className="mb-2 space-y-1 font-mono text-[11px]">
                        {toolParts.map((tool) => (
                          <div
                            key={tool.key}
                            className="flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-violet-200"
                          >
                            <Cpu className="h-3 w-3 shrink-0" />
                            <span className="font-semibold">{tool.name}</span>
                            <span className="min-w-0 flex-1 truncate text-zinc-400">
                              {tool.detail}
                            </span>
                            <span
                              className={
                                tool.status === 'done'
                                  ? 'text-emerald-400'
                                  : tool.status === 'failed'
                                    ? 'text-red-400'
                                    : 'animate-pulse text-amber-300'
                              }
                            >
                              {tool.status === 'done'
                                ? 'ok'
                                : tool.status === 'failed'
                                  ? 'Fehler'
                                  : '…'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {fileParts.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {fileParts.map((file) => (
                          <MediaThumb
                            key={file.key}
                            mediaType={file.mediaType}
                            url={file.url}
                            name={file.name}
                            controls
                            className="max-h-48 max-w-full rounded-lg border border-white/20"
                          />
                        ))}
                      </div>
                    )}

                    {!isUser && displayText && (
                      <div className="mb-2 flex justify-end gap-1">
                        <SpeakButton
                          active={speakingId === message.id}
                          onClick={() => void speak(message.id, displayText)}
                        />
                        <CopyButton text={displayText} />
                      </div>
                    )}

                    {isUser ? displayText : <RichText text={displayText} />}

                    {!isUser && displayText.length > 300 && (
                      <div className="mt-2 flex justify-end">
                        <CopyButton text={displayText} />
                      </div>
                    )}

                    {sources.length > 0 && (
                      <div className="mt-3 border-t border-zinc-800 pt-2 text-[11px] text-zinc-400">
                        <p className="mb-1">Quellen</p>
                        <ul className="space-y-0.5">
                          {sources.map((source) => (
                            <li key={source.key} className="truncate">
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-300 hover:underline"
                              >
                                {source.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

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
            {/* Status: arbeitet / fertig */}
            {(isLoading || justFinished) && (
              <div className="flex items-center gap-2 text-xs">
                {isLoading ? (
                  <span className="animate-pulse text-amber-300">
                    ●{' '}
                    {isAgentMode && !isImageModel
                      ? 'Agent arbeitet…'
                      : 'Antwort wird geschrieben…'}
                  </span>
                ) : (
                  <span className="text-emerald-400">✓ Fertig</span>
                )}
              </div>
            )}

            {/* Angehängte Bilder/Videos */}
            {attachedMedia.length > 0 && (
              <div className="mb-2 space-y-1">
                <div className="flex flex-wrap gap-2">
                  {attachedMedia.map((media, index) => (
                    <div key={`${media.name}-${index}`} className="relative">
                      <MediaThumb
                        mediaType={media.mediaType}
                        url={media.url}
                        name={media.name}
                        className="h-16 w-16 rounded-lg border border-zinc-700 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeMedia(index)}
                        className="absolute -right-1 -top-1 rounded-full bg-zinc-800 p-0.5 text-zinc-300 transition hover:text-red-400"
                        aria-label="Anhang entfernen"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {mediaUnsupported && (
                  <p className="text-[11px] text-amber-300">
                    Das gewählte Modell kann {mediaNeedsVideo ? 'keine Videos' : 'keine Bilder'}.
                    Es wird automatisch ein passendes Modell benutzt.
                  </p>
                )}
              </div>
            )}

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
                  onClick={() => void toggleSpeechRecognition()}
                  disabled={isTranscribing}
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
                  isTranscribing
                    ? 'Wandle Sprache in Text um...'
                    : isListening
                    ? 'Höre zu... Sprich jetzt...'
                    : isImageModel
                      ? 'Beschreibe das Bild...'
                      : isAgentMode
                        ? 'Agent-Aufgabe, z. B. „Fixe den Fehler in lib/db.ts“...'
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
                  disabled={
                    !input.trim() &&
                    attachedFiles.length === 0 &&
                    attachedMedia.length === 0
                  }
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

              {/* Agent-Modus Schalter */}
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">GitHub-Agent</p>
                  <p className="text-[11px] text-zinc-500">
                    Liest das Repo über GitHub. Ändern (Branch agent-work) nur als Admin.
                  </p>
                  {!canAgent && (
                    <p className="text-[11px] text-amber-300">
                      Für dein Konto nicht freigeschaltet. Der Admin kann ihn erlauben.
                    </p>
                  )}
                  {isImageModel && (
                    <p className="text-[11px] text-amber-300">
                      Beim Bildmodell nicht verfügbar.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAgentMode}
                  onClick={() => setIsAgentMode((value) => !value)}
                  disabled={!canAgent}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    isAgentMode ? 'bg-violet-600' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      isAgentMode ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Schnellstart und Schreib-Schalter */}
              {canAgent && (
                <div className="space-y-2 border-b border-zinc-800 px-4 py-3">
                  {isAdminUser && (
                    <label className="flex items-center justify-between gap-3 text-xs text-zinc-300">
                      <span>Änderungen erlauben (sonst nur lesen)</span>
                      <input
                        type="checkbox"
                        checked={agentWrite}
                        onChange={(event) => setAgentWrite(event.target.checked)}
                        className="h-4 w-4 accent-violet-500"
                      />
                    </label>
                  )}
                  <p className="text-[11px] text-zinc-500">Schnellstart (nur lesen):</p>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setIsAgentMode(true);
                          setAgentWrite(false);
                          setInput(preset.prompt);
                          setIsAgentOpen(false);
                        }}
                        className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 transition hover:bg-zinc-700"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
