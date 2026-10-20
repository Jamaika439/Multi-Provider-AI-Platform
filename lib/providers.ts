/**
 * lib/providers.ts
 * =============================================================================
 * Verbindet die Einträge aus lib/models.ts mit den echten Anbieter-Bibliotheken
 * (Vercel AI SDK). Läuft NUR auf dem Server, weil hier die API-Keys gelesen
 * werden. Diese Datei darf nie in Client-Code (page.tsx) importiert werden,
 * sonst landen die Keys im Browser.
 *
 * Mehrere Keys pro Anbieter:
 *   In .env.local kannst du für jeden Anbieter Ersatz-Keys eintragen, indem du
 *   _2 oder _3 an den Namen hängst, z. B.
 *     OPENAI_API_KEY=sk-...        (wird zuerst benutzt)
 *     OPENAI_API_KEY_2=sk-...      (springt ein, wenn Key 1 abgelehnt wird)
 *   Wie der Wechsel funktioniert, steht in lib/failover-fetch.ts.
 * =============================================================================
 */
import { createCohere } from '@ai-sdk/cohere';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

import { createFailoverFetch, type FailoverKey } from './failover-fetch';
import type { ModelDefinition, ProviderName } from './models';

/** Anbieter, die einen API-Key brauchen ("image" braucht keinen). */
export type KeyedProvider = Exclude<ProviderName, 'image'>;

/**
 * Name der Umgebungsvariable (in .env.local) für den ersten Key jedes Anbieters.
 * Ersatz-Keys heißen genauso, mit angehängtem _2 oder _3.
 */
const API_KEY_ENV: Record<KeyedProvider, string> = {
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  cohere: 'COHERE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** Suffixe der Ersatz-Keys. */
const KEY_SUFFIXES = ['', '_2', '_3'];

/**
 * Eigener Fehlertyp für "Key fehlt". Die Chat-Route erkennt ihn daran und
 * zeigt dem Nutzer eine verständliche Meldung statt "Serverfehler".
 */
export class MissingApiKeyError extends Error {
  constructor(envName: string) {
    super(
      `Der API-Key ${envName} fehlt. Trage ihn in .env.local ein und starte den Server neu.`
    );
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Räumt einen Key aus den Umgebungsvariablen auf und entfernt typische
 * Copy-and-paste-Fehler:
 *  - Leerzeichen und Zeilenumbrüche am Rand
 *  - Anführungszeichen um den Key ("sk-..." oder 'sk-...')
 *  - ein versehentlich mitkopiertes "Bearer " davor
 */
function cleanKey(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

/**
 * Liest ALLE Keys eines Anbieters (Key 1, dann _2, dann _3), ohne leere.
 * Wird auch vom Verbindungstest (app/api/health/route.ts) benutzt.
 */
export function getProviderKeys(provider: KeyedProvider): FailoverKey[] {
  const baseName = API_KEY_ENV[provider];
  const keys: FailoverKey[] = [];

  for (const suffix of KEY_SUFFIXES) {
    const name = `${baseName}${suffix}`;
    const value = cleanKey(process.env[name]);

    if (value) {
      keys.push({ name, value });
    }
  }

  return keys;
}

/** Name der Hauptvariable eines Anbieters, für Fehlermeldungen. */
export function getPrimaryKeyName(provider: KeyedProvider): string {
  return API_KEY_ENV[provider];
}

/**
 * Liefert Key 1 und eine fetch-Funktion (siehe lib/failover-fetch.ts), die
 *  - bei Ablehnung automatisch auf den nächsten Key wechselt, falls Ersatz-Keys
 *    existieren, und
 *  - Fehlermeldungen um den Namen des benutzten Keys ergänzt (z. B.
 *    "[Key: OPENROUTER_API_KEY -> HTTP 401]"). Das gilt auch bei nur einem Key,
 *    damit man im Chat sofort sieht, welcher Key den Fehler verursacht hat.
 *
 * `headerStyle` legt fest, in welchem Header der Anbieter den Key erwartet:
 *   - 'bearer': "Authorization: Bearer <key>" (fast alle Anbieter)
 *   - 'google': "x-goog-api-key: <key>"
 */
function resolveAuth(provider: KeyedProvider, headerStyle: 'bearer' | 'google') {
  const keys = getProviderKeys(provider);

  if (keys.length === 0) {
    throw new MissingApiKeyError(API_KEY_ENV[provider]);
  }

  const fetchWithFailover = createFailoverFetch({
    provider,
    keys,
    applyKey: (headers, key) => {
      if (headerStyle === 'google') {
        headers.set('x-goog-api-key', key);
      } else {
        headers.set('authorization', `Bearer ${key}`);
      }
    },
  });

  return { apiKey: keys[0].value, fetch: fetchWithFailover };
}

/**
 * Liefert das Sprachmodell-Objekt für einen Eintrag der Modellliste.
 * Das Ergebnis geht direkt an streamText() in app/api/chat/route.ts.
 *
 * Die Keys werden erst hier gelesen (nicht beim Start der App). Ein fehlender
 * Key eines Anbieters betrifft dadurch nur dessen Modelle, alle anderen laufen
 * weiter.
 */
export function getLanguageModel(model: ModelDefinition): LanguageModel {
  switch (model.provider) {
    case 'google':
      return createGoogleGenerativeAI(resolveAuth('google', 'google'))(model.id);

    case 'openai':
      // Ohne .chat(): Neuere OpenAI-Modelle sprechen nur die Responses-API.
      // Das SDK wählt sie hier automatisch.
      return createOpenAI(resolveAuth('openai', 'bearer'))(model.id);

    case 'groq':
      return createGroq(resolveAuth('groq', 'bearer'))(model.id);

    case 'cohere':
      return createCohere(resolveAuth('cohere', 'bearer'))(model.id);

    case 'openrouter':
      return createOpenRouter(resolveAuth('openrouter', 'bearer')).chat(model.id);

    default:
      // Passiert nur für 'image'. Dafür gibt es kein Sprachmodell.
      throw new Error(`Für "${model.key}" gibt es kein Sprachmodell.`);
  }
}