import { NextResponse } from 'next/server';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { saveChatMessages } from '@/lib/db';
import {
  DEFAULT_MODEL,
  findModel,
  IMAGE_MODEL,
  MODELS,
  type ModelDefinition,
} from '@/lib/models';
import {
  getLanguageModel,
  getProviderKeys,
  MissingApiKeyError,
  type KeyedProvider,
} from '@/lib/providers';
import { ATTACHMENT_MARKER, getMessageText, makeChatTitle } from '@/lib/messages';
import { agentTools, AGENT_SYSTEM } from '@/lib/agents/tools';
import { generateImage, saveImage } from '@/lib/images';
import { logUsage } from '@/lib/usage';
import { claimChat, getCurrentUser, isAdmin } from '@/lib/auth';

// Maximale Laufzeit einer Anfrage in Sekunden (muss ein fester Wert sein).
// Lange Agent-Läufe brauchen mehr (z. B. 300), sofern dein Vercel-Plan es
// erlaubt. Die Abbruch-Zeiten unten müssen immer kleiner bleiben.
export const maxDuration = 60;

/**
 * Maximale Ausgabelänge pro Antwort (bzw. pro Agent-Schritt) je Anbieter.
 * Zu hohe Werte lehnt ein Anbieter mit Fehler ab, dann hier senken.
 * Genaue Limits stehen in der Doku des jeweiligen Anbieters/Modells.
 */
const OUTPUT_LIMITS: Record<string, number> = {
  google: 32000,
  openai: 32000,
  groq: 16000,
  openrouter: 16000,
  cohere: 4000,
};
const DEFAULT_OUTPUT_LIMIT = 8000;

const AGENT_MAX_STEPS = 15;

/** Form einer vom Browser gesendeten Nachricht (AI SDK: Text steckt in "parts"). */
interface IncomingMessage {
  role?: string;
  content?: unknown;
  parts?: readonly {
    type: string;
    text?: unknown;
    mediaType?: string;
    url?: string;
    filename?: string;
  }[];
}

interface MediaFile {
  mediaType: string;
  url: string;
  filename: string;
}

/** Regel für Songtexte (urheberrechtlich geschützt): Link statt Volltext. */
const LYRICS_RULE =
  'Songtexte: Gib niemals vollständige Songtexte oder lange Auszüge wieder (urheberrechtlich geschützt). Wenn jemand Lyrics möchte oder einen Song anhand einer Textzeile sucht: Nenne Titel und Künstler, gib einen Link zu den vollständigen Lyrics bei einem lizenzierten Anbieter und zitiere höchstens eine kurze Zeile (unter 10 Wörter) zur Überprüfung. Kennst du keine sichere Direkt-Adresse, nutze einen Suchlink, z. B. https://genius.com/search?q=TITEL+KÜNSTLER (Leerzeichen als +). Erfinde keine Adressen. Bei allen anderen Fragen verhalte dich ganz normal.';

/** Für Modelle ohne System-Nachricht (OpenRouter Gratis): Regel vor die Nutzerfrage setzen. */
function withRuleInUserMessage(message: ModelMessage): ModelMessage {
  if (message.role !== 'user') return message;
  const note = `[Hinweis an die KI: ${LYRICS_RULE}]\n\n`;
  if (typeof message.content === 'string') {
    return { ...message, content: note + message.content };
  }
  let done = false;
  return {
    ...message,
    content: message.content.map((part) => {
      if (!done && part.type === 'text') {
        done = true;
        return { ...part, text: note + part.text };
      }
      return part;
    }),
  };
}

/** Nur-Lesen-Werkzeuge für Konten ohne Schreibrecht und für "Repo durchschauen". */
const readOnlyTools = {
  listFiles: agentTools.listFiles,
  readFile: agentTools.readFile,
  fileHistory: agentTools.fileHistory,
  searchCode: agentTools.searchCode,
} as unknown as ToolSet;

const READ_ONLY_NOTE =
  '\n\nWICHTIG: In diesem Lauf darfst du NICHTS ändern. Du hast nur Lese-Werkzeuge. Lies, analysiere und berichte.';

/** Gesamtgröße aller Bilder/Videos pro Anfrage (Vercel erlaubt ca. 4,5 MB Body). */
const MEDIA_MAX_CHARS = 4_000_000;

/** Bilder/Videos der letzten Nutzernachricht. Nur eingebettete Data-URLs (keine Fremdadressen). */
function extractMedia(messages: IncomingMessage[]): MediaFile[] {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last || !Array.isArray(last.parts)) return [];

  return last.parts
    .filter(
      (part) =>
        part.type === 'file' &&
        typeof part.url === 'string' &&
        part.url.startsWith('data:') &&
        typeof part.mediaType === 'string' &&
        (part.mediaType.startsWith('image/') || part.mediaType.startsWith('video/'))
    )
    .map((part) => ({
      mediaType: part.mediaType as string,
      url: part.url as string,
      filename: part.filename ?? 'Anhang',
    }));
}

/** Erstes Modell mit Bild-/Video-Unterstützung, für das ein Key eingetragen ist. */
function pickMediaModel(needVideo: boolean, admin: boolean): ModelDefinition | undefined {
  return (MODELS as readonly ModelDefinition[]).find(
    (model) =>
      model.provider !== 'image' &&
      (needVideo ? model.video : model.vision) &&
      (model.isFree || admin) &&
      getProviderKeys(model.provider as KeyedProvider).length > 0
  );
}

/** Vermerk für die Datenbank: Medien selbst werden nicht gespeichert. */
function withMediaNote(text: string, media: MediaFile[]): string {
  const header = text.includes(ATTACHMENT_MARKER) ? '' : `\n\n${ATTACHMENT_MARKER}\n`;
  const lines = media
    .map((file) => `\n--- Datei: ${file.filename} ---\n(Medien werden nicht gespeichert)\n--- Ende der Datei ---`)
    .join('');
  return `${text}${header}${lines}`;
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
    }

    const body = await req.json();
    const { messages, chatId, model: modelKey, agent, agentMode } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Keine gültigen Nachrichten übergeben' },
        { status: 400 }
      );
    }

    let modelDef = findModel(modelKey) ?? findModel(DEFAULT_MODEL)!;
    const activeChatId = chatId || `chat-${Date.now()}`;

    // Bezahlte Modelle und der Agent-Modus (schreibt ins Repo) nur für den Admin
    const admin = await isAdmin();
    if (!modelDef.isFree && !admin) {
      return NextResponse.json(
        { error: 'Bezahlte Modelle sind nur für den Admin freigeschaltet.' },
        { status: 403 }
      );
    }
    // Agent: Admin darf lesen und ändern. Konten mit Haken im Admin-Bereich dürfen nur lesen.
    if (agent === true && !admin && !user.canAgent) {
      return NextResponse.json(
        { error: 'Der Agent-Modus ist für dein Konto nicht freigeschaltet. Der Admin kann ihn im Admin-Bereich erlauben.' },
        { status: 403 }
      );
    }
    const agentWrite = admin && agentMode === 'write';

    // Bilder/Videos: Kann das gewählte Modell sie nicht, wird automatisch ein passendes genommen
    const media = extractMedia(messages as IncomingMessage[]);
    if (media.reduce((sum, file) => sum + file.url.length, 0) > MEDIA_MAX_CHARS) {
      return NextResponse.json(
        { error: 'Bilder und Videos sind zusammen zu groß (maximal ca. 3 MB).' },
        { status: 413 }
      );
    }
    if (media.length > 0 && modelDef.provider !== 'image') {
      const needVideo = media.some((file) => file.mediaType.startsWith('video/'));
      if (!(needVideo ? modelDef.video : modelDef.vision)) {
        const alternative = pickMediaModel(needVideo, admin);
        if (!alternative) {
          return NextResponse.json(
            {
              error: needVideo
                ? 'Kein Modell mit Video-Unterstützung verfügbar (Google-Key fehlt?).'
                : 'Kein Modell mit Bild-Unterstützung verfügbar (Google- oder NVIDIA-Key fehlt?).',
            },
            { status: 400 }
          );
        }
        modelDef = alternative;
      }
    }

    // Chat dem Nutzer zuordnen; fremde Chat-IDs werden abgelehnt
    if (!(await claimChat(activeChatId, user.id))) {
      return NextResponse.json({ error: 'Kein Zugriff auf diesen Chat.' }, { status: 403 });
    }

    // Nachrichten formatieren
    const formattedMessages = (messages as IncomingMessage[]).map((m) => {
      let content = m.content;
      if (!content && Array.isArray(m.parts)) {
        content = getMessageText(m);
      }
      return {
        role: (m.role === 'assistant' ? 'assistant' : 'user') as
          | 'user'
          | 'assistant',
        content: typeof content === 'string' ? content : String(content || ''),
      };
    });

    // Für das Modell: letzte Nutzernachricht inkl. Bilder/Videos
    const lastUserIndex = formattedMessages.map((m) => m.role).lastIndexOf('user');
    const modelMessages: ModelMessage[] = formattedMessages.map((m, index) =>
      media.length > 0 && index === lastUserIndex
        ? {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: m.content },
              ...media.map((file) =>
                file.mediaType.startsWith('image/')
                  ? { type: 'image' as const, image: file.url, mediaType: file.mediaType }
                  : { type: 'file' as const, data: file.url, mediaType: file.mediaType }
              ),
            ],
          }
        : m
    );
    // Für die Datenbank: nur Text plus Hinweis auf die Anhänge
    const savedMessages = formattedMessages.map((m, index) =>
      media.length > 0 && index === lastUserIndex
        ? { ...m, content: withMediaNote(m.content, media) }
        : m
    );

    const firstUserText =
      formattedMessages.find((m: { role: string }) => m.role === 'user')
        ?.content || '';
    const activeTitle = makeChatTitle(firstUserText);

    // === Bildgenerierung (Pollinations) ===
    if (modelDef.key === IMAGE_MODEL || modelDef.provider === 'image') {
      const prompt =
        formattedMessages[formattedMessages.length - 1]?.content || '';
      let imageUrl = '';
      let imageProvider = 'pollinations';

      if (modelDef.id === 'flux') {
        // FLUX über Cloudflare: Fehler offen anzeigen statt stillschweigend umzuschalten
        const generated = await generateImage(prompt);
        if (!generated) {
          return NextResponse.json(
            {
              error:
                'FLUX braucht CLOUDFLARE_API_TOKEN (Berechtigung "Workers AI") und CLOUDFLARE_ACCOUNT_ID.',
            },
            { status: 400 }
          );
        }
        const imageId = await saveImage(user.id, generated.mime, generated.base64);
        imageUrl = `/api/images/${imageId}`;
        imageProvider = 'cloudflare';
      } else {
        imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
          prompt
        )}?width=1024&height=1024&model=flux&enhance=true&nologo=true`;
      }

      await logUsage({
        userId: user.id,
        kind: 'image',
        provider: imageProvider,
        model: modelDef.id,
      });
      const imageMarkdown = `![Generiertes Bild](${imageUrl})`;

      await saveChatMessages(activeChatId, activeTitle, [
        ...formattedMessages,
        { role: 'assistant', content: imageMarkdown },
      ]);

      // Korrektes UI-Message-Stream-Format für useChat
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          const id = `img-${Date.now()}`;
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: imageMarkdown });
          writer.write({ type: 'text-end', id });
        },
      });

      return createUIMessageStreamResponse({ stream });
    }

    // === Sprachmodell (normal oder Agent-Modus) ===
    const useAgent = agent === true;

    if (useAgent && !process.env.GITHUB_TOKEN) {
      return NextResponse.json(
        {
          error:
            'Agent-Modus: GITHUB_TOKEN fehlt (in .env.local bzw. in den Vercel-Umgebungsvariablen setzen).',
        },
        { status: 400 }
      );
    }

    const languageModel = getLanguageModel(modelDef);
    const maxOutputTokens =
      OUTPUT_LIMITS[modelDef.provider] ?? DEFAULT_OUTPUT_LIMIT;

    // Agent: Repo-Werkzeuge. Websuche-Modelle: Google-Suche (Gemini) bzw. eingebaut (Groq Compound).
    const activeTools: ToolSet | undefined = useAgent
      ? agentWrite
        ? agentTools
        : readOnlyTools
      : modelDef.webSearch === 'google'
        ? ({ google_search: google.tools.googleSearch({}) } as unknown as ToolSet)
        : modelDef.webSearch === 'groq'
          ? ({ browser_search: groq.tools.browserSearch({}) } as unknown as ToolSet)
          : undefined;

    // OpenRouter-Gratis-Modelle lehnen System-Nachrichten teils ab
    const messagesForModel: ModelMessage[] =
      !useAgent && modelDef.provider === 'openrouter'
        ? modelMessages.map((m, index) =>
            index === lastUserIndex ? withRuleInUserMessage(m) : m
          )
        : modelMessages;

    const result = streamText({
      model: languageModel,
      messages: messagesForModel,
      maxOutputTokens,
      // Keine stillen Wiederholungen: Fehler sofort anzeigen statt ewig laden
      maxRetries: 0,
      // Eigener Abbruch kurz vor dem Vercel-Limit, damit eine Fehlermeldung
      // im Chat erscheint, statt dass die Verbindung stumm abreißt
      abortSignal: AbortSignal.timeout(55_000),
      onError: ({ error }) => {
        console.error('[streamText]', error);
      },
      ...(activeTools ? { tools: activeTools } : {}),
      ...(useAgent
        ? {
            system: agentWrite ? AGENT_SYSTEM : AGENT_SYSTEM + READ_ONLY_NOTE,
            stopWhen: stepCountIs(AGENT_MAX_STEPS),
          }
        : modelDef.provider !== 'openrouter'
          ? { system: LYRICS_RULE }
          : {}),
      onFinish: async ({ text, steps, totalUsage }) => {
        try {
          // Im Agent-Modus steht der Text über mehrere Schritte verteilt.
          const finalText = useAgent
            ? steps
                .map((step) => step.text)
                .filter(Boolean)
                .join('\n\n')
            : text;

          await saveChatMessages(activeChatId, activeTitle, [
            ...savedMessages,
            { role: 'assistant', content: finalText || '' },
          ]);
        } catch (dbError) {
          console.error('Fehler beim Speichern in Neon:', dbError);
        }

        await logUsage({
          userId: user.id,
          kind: 'chat',
          provider: modelDef.provider,
          model: modelDef.key,
          inputTokens: totalUsage?.inputTokens,
          outputTokens: totalUsage?.outputTokens,
        });
      },
    });

    // Echte Fehlermeldung des Anbieters anzeigen (statt "An error occurred.")
    return result.toUIMessageStreamResponse({
      sendSources: true,
      onError: (error) =>
        (error instanceof Error ? error.message : String(error)).slice(0, 300),
    });
  } catch (error: unknown) {
    console.error('Fehler in /api/chat:', error);

    if (error instanceof MissingApiKeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error:
          (error instanceof Error && error.message) ||
          'Fehler beim Verarbeiten der Nachricht',
      },
      { status: 500 }
    );
  }
}
