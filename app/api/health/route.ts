/**
 * app/api/health/route.ts
 * =============================================================================
 * Endpunkt GET /api/health: der "Verbindungstest" für deine API-Keys.
 *
 * Für jeden Anbieter und jeden eingetragenen Key (Key 1, _2, _3) wird eine
 * kleine Abfrage geschickt. Daran sieht man sofort, WELCHER Key nicht
 * funktioniert und was der Anbieter dazu sagt.
 *
 * Zwei Stufen:
 *  - Normal (/api/health): Nur Lese-Abfragen (Modellliste bzw. Key-Info). Kostet
 *    nichts, prüft aber nur, ob der Key GÜLTIG ist. Ein Key ohne Guthaben ist
 *    dabei trotzdem "gültig".
 *  - Tief (/api/health?deep=1): Zusätzlich eine winzige echte Anfrage (wenige
 *    Token) bei OpenAI und Google. Nur so sieht man, ob noch Guthaben bzw.
 *    Kontingent da ist. Verbraucht minimal Guthaben/Kontingent.
 *
 * Bei OpenRouter gibt es eine Zusatzdiagnose, wenn der Key mit 401 abgelehnt
 * wird (siehe diagnoseOpenRouter).
 *
 * Wichtig:
 *  - Die Keys selbst verlassen den Server nie. Die Antwort enthält nur den
 *    NAMEN der Variable (z. B. "OPENAI_API_KEY_2"), nie den Wert.
 *  - Läuft eine Firewall oder ein Proxy dazwischen (z. B. Schul- oder
 *    Firmennetz), zeigt der Test das ebenfalls.
 * =============================================================================
 */
import { NextResponse } from 'next/server';

import { MODELS } from '@/lib/models';
import {
  getPrimaryKeyName,
  getProviderKeys,
  type KeyedProvider,
} from '@/lib/providers';

/** Anfrage-Timeout pro Key, damit ein hängender Anbieter den Test nicht blockiert. */
const TIMEOUT_MS = 10_000;

/**
 * Pro Anbieter: Adresse der Test-Abfrage und Art, wie der Key mitgeschickt wird.
 * Es sind reine Lese-Abfragen, sie verbrauchen weder Guthaben noch Kontingent.
 */
const CHECKS: Record<
  KeyedProvider,
  { label: string; url: string; header: 'bearer' | 'google' }
> = {
  google: {
    label: 'Google (Gemini)',
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    header: 'google',
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/models',
    header: 'bearer',
  },
  groq: {
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1/models',
    header: 'bearer',
  },
  cohere: {
    label: 'Cohere',
    url: 'https://api.cohere.com/v1/models?page_size=1',
    header: 'bearer',
  },
  openrouter: {
    label: 'OpenRouter',
    // Liefert Infos zum Key selbst, ist also der direkteste Gültigkeitstest.
    url: 'https://openrouter.ai/api/v1/auth/key',
    header: 'bearer',
  },
};

/** Ergebnis für einen Key (oder einen Anbieter ganz ohne Key). */
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

/**
 * Kürzt eine Anbieter-Antwort auf eine lesbare Meldung. Enthält der Text den
 * Key selbst (manche Anbieter geben ihn im Fehler zurück), wird er unkenntlich
 * gemacht, damit er nicht im Browser landet.
 */
function toMessage(raw: string, secret: string): string {
  let text = raw;

  try {
    const json = JSON.parse(raw);
    text = json?.error?.message ?? json?.message ?? json?.error ?? raw;
    if (typeof text !== 'string') text = JSON.stringify(text);
  } catch {
    // Kein JSON: Rohtext verwenden.
  }

  return text.split(secret).join('***').replace(/\s+/g, ' ').slice(0, 300);
}

/** Baut die Header mit dem Key, je nach Anbieter. */
function authHeaders(
  style: 'bearer' | 'google',
  key: string
): Record<string, string> {
  return style === 'google'
    ? { 'x-goog-api-key': key }
    : { authorization: `Bearer ${key}` };
}

/**
 * Beschreibt die FORM eines Keys, ohne ihn preiszugeben: Länge und ein paar
 * Ja/Nein-Merkmale. Damit lassen sich Copy-and-paste-Fehler erkennen
 * (abgeschnitten, falscher Anbieter, Leerzeichen im Key).
 */
function describeKeyShape(key: string) {
  return {
    length: key.length,
    startsWithSkOr: key.startsWith('sk-or-'),
    startsWithSkOrV1: key.startsWith('sk-or-v1-'),
    hasWhitespace: /\s/.test(key),
    hasUnusualChars: /[^A-Za-z0-9_-]/.test(key),
  };
}

/**
 * Zusatzdiagnose für OpenRouter bei 401.
 *
 * Die Meldung "Missing Authentication header" heißt: OpenRouter hat keine
 * brauchbaren Anmeldedaten erhalten. Um die Ursache einzugrenzen, wird zusätzlich
 * ein absichtlich FALSCHER, aber korrekt geformter Key geschickt:
 *  - Antwortet OpenRouter darauf anders (z. B. "User not found"), kommt der
 *    Header bei OpenRouter an, und dein Key selbst ist das Problem.
 *  - Antwortet OpenRouter identisch, kommen die Anmeldedaten offenbar gar nicht
 *    an (Firewall, Proxy, Schul- oder Firmennetz).
 */
async function diagnoseOpenRouter(
  keyValue: string,
  realMessage: string
): Promise<string> {
  const shape = describeKeyShape(keyValue);
  const shapeText = `Dein Key hat ${shape.length} Zeichen`;

  if (shape.hasWhitespace || shape.hasUnusualChars) {
    return `${shapeText} und enthält Leerzeichen oder Sonderzeichen. Kopiere den Key neu, ohne Anführungszeichen und ohne Leerzeichen.`;
  }

  if (!shape.startsWithSkOr) {
    return (
      `${shapeText} und beginnt NICHT mit "sk-or-". Das ist vermutlich kein OpenRouter-Key ` +
      `(Key eines anderen Anbieters oder abgeschnitten). OpenRouter-Keys beginnen mit "sk-or-v1-".`
    );
  }

  try {
    const fakeKey = `sk-or-v1-${'0'.repeat(64)}`;
    const response = await fetch(CHECKS.openrouter.url, {
      headers: authHeaders('bearer', fakeKey),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const fakeMessage = toMessage(await response.text(), fakeKey);

    if (fakeMessage === realMessage) {
      return (
        `${shapeText} und hat das richtige Format. Ein absichtlich falscher Key liefert aber dieselbe ` +
        `Meldung: Die Anmeldedaten kommen bei OpenRouter offenbar nicht an (Firewall, Proxy oder ` +
        `Schul-/Firmennetz?). Teste im Handy-Hotspot und mit: curl.exe https://openrouter.ai/api/v1/auth/key -H "Authorization: Bearer DEIN_KEY"`
      );
    }

    return (
      `${shapeText} und hat das richtige Format. OpenRouter erkennt die Anmeldung (ein Fake-Key ` +
      `ergibt: "${fakeMessage}"), lehnt aber DEINEN Key ab. Er ist vermutlich gelöscht, ` +
      `abgelaufen oder unvollständig kopiert. Erzeuge einen neuen Key auf openrouter.ai/keys.`
    );
  } catch {
    return `${shapeText} und hat das richtige Format. Die Zusatzprüfung war nicht möglich (Netzwerkfehler).`;
  }
}

/**
 * Tiefer Test: winzige echte Anfrage, um Guthaben/Kontingent zu prüfen.
 * Nutzt jeweils das erste Modell des Anbieters aus lib/models.ts, damit die ID
 * aktuell bleibt. Gibt es für den Anbieter keinen tiefen Test, wird null geliefert.
 */
function buildDeepRequest(
  provider: KeyedProvider,
  keyValue: string
): { url: string; init: RequestInit } | null {
  const modelId = MODELS.find((model) => model.provider === provider)?.id;

  if (!modelId) return null;

  if (provider === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
      init: {
        method: 'POST',
        headers: {
          ...authHeaders('google', keyValue),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Antworte mit ok.' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      },
    };
  }

  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/responses',
      init: {
        method: 'POST',
        headers: {
          ...authHeaders('bearer', keyValue),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          input: 'Antworte mit ok.',
          max_output_tokens: 16,
        }),
      },
    };
  }

  return null;
}

async function checkKey(
  provider: KeyedProvider,
  keyName: string,
  keyValue: string,
  deep: boolean
): Promise<KeyCheckResult> {
  const check = CHECKS[provider];
  const deepRequest = deep ? buildDeepRequest(provider, keyValue) : null;

  const url = deepRequest?.url ?? check.url;
  const init: RequestInit = deepRequest?.init ?? {
    headers: authHeaders(check.header, keyValue),
  };

  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });

    if (response.ok) {
      return {
        provider: check.label,
        keyName,
        configured: true,
        ok: true,
        status: response.status,
        message: deepRequest
          ? 'Key gültig, Guthaben/Kontingent vorhanden'
          : 'Key gültig',
      };
    }

    const message =
      toMessage(await response.text(), keyValue) || `HTTP ${response.status}`;

    const result: KeyCheckResult = {
      provider: check.label,
      keyName,
      configured: true,
      ok: false,
      status: response.status,
      message,
    };

    if (provider === 'openrouter' && response.status === 401) {
      result.hint = await diagnoseOpenRouter(keyValue, message);
    }

    // 404 bei der tiefen Prüfung heißt meist: Modell-ID nicht (mehr) vorhanden,
    // nicht: Key kaputt.
    if (deepRequest && response.status === 404) {
      result.hint =
        'Der Key wurde akzeptiert, aber das Testmodell wurde nicht gefunden. Prüfe die Modell-ID in lib/models.ts.';
    }

    return result;
  } catch (error) {
    // Kein Netz, Timeout, Firewall ...
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Zeitüberschreitung (keine Antwort in 10 Sekunden)'
        : 'Netzwerkfehler (Anbieter nicht erreichbar)';

    return {
      provider: check.label,
      keyName,
      configured: true,
      ok: false,
      status: null,
      message: reason,
    };
  }
}

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get('deep') === '1';

  const providers = Object.keys(CHECKS) as KeyedProvider[];
  const jobs: Promise<KeyCheckResult>[] = [];
  const missing: KeyCheckResult[] = [];

  for (const provider of providers) {
    const keys = getProviderKeys(provider);

    if (keys.length === 0) {
      missing.push({
        provider: CHECKS[provider].label,
        keyName: getPrimaryKeyName(provider),
        configured: false,
        ok: false,
        status: null,
        message: 'Kein Key eingetragen',
      });
      continue;
    }

    for (const key of keys) {
      jobs.push(checkKey(provider, key.name, key.value, deep));
    }
  }

  // Alle Prüfungen gleichzeitig starten, das dauert dann nur so lang wie die langsamste.
  const checked = await Promise.all(jobs);

  return NextResponse.json([...checked, ...missing]);
}