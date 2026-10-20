/**
 * lib/models.ts
 * =============================================================================
 * Zentrale Modellliste der App.
 *
 * Diese Datei wird von ZWEI Seiten benutzt:
 *  - Client (app/page.tsx): baut daraus das Dropdown "Modell wählen".
 *  - Server (app/api/chat/route.ts + lib/providers.ts): sucht anhand des
 *    Schlüssels (`key`) heraus, welcher Anbieter und welche Modell-ID gemeint ist.
 *
 * Wenn ein Anbieter ein Modell abschaltet oder umbenennt (das passiert alle paar
 * Monate), musst du NUR hier etwas ändern. Alles andere passt sich an.
 *
 * Felder eines Eintrags:
 *  - key:      interner, stabiler Name. Wird vom Browser an den Server geschickt.
 *              Nicht mit der Modell-ID verwechseln.
 *  - label:    Text, der im Dropdown angezeigt wird.
 *  - group:    Überschrift der Dropdown-Gruppe (optgroup).
 *  - provider: Welcher Anbieter dahinter steckt (siehe lib/providers.ts).
 *  - id:       Modell-ID EXAKT so, wie der Anbieter sie erwartet. Ist die ID
 *              falsch oder veraltet, meldet der Anbieter "model not found".
 *
 * Stand der IDs: 29.09.2026 (Recherche in Anbieter-Dokus und Modelllisten).
 * Aktuelle Listen der Anbieter:
 *  - Google:     https://ai.google.dev/gemini-api/docs/models
 *  - OpenAI:     https://developers.openai.com/api/docs/models
 *  - Groq:       https://console.groq.com/docs/models
 *  - Cohere:     https://docs.cohere.com/docs/models
 *  - OpenRouter: https://openrouter.ai/collections/free-models
 *
 * Mistral und SambaNova wurden entfernt, weil sie kostenpflichtig sind.
 * =============================================================================
 */

/** Alle Anbieter, die die App kennt. "image" ist kein Sprachmodell, sondern die Bildgenerierung. */
export type ProviderName =
  | 'google'
  | 'openai'
  | 'groq'
  | 'cohere'
  | 'openrouter'
  | 'image';

/** Form eines Eintrags in der Modellliste. */
export interface ModelDefinition {
  key: string;
  label: string;
  group: string;
  provider: ProviderName;
  /** Modell-ID, so wie der jeweilige Anbieter sie erwartet */
  id: string;
}

/**
 * Die eigentliche Liste.
 *
 * `as const satisfies ...` bedeutet: TypeScript prüft, dass jeder Eintrag die
 * Form von ModelDefinition hat, und merkt sich gleichzeitig die exakten
 * Schlüssel. Dadurch ist `ModelKey` unten eine Liste der echten Schlüssel und
 * Tippfehler fallen sofort beim Kompilieren auf.
 */
export const MODELS = [
  // --- Google AI Studio --------------------------------------------------------
  // Hat ein kostenloses Kontingent. Ein zweiter Key (GOOGLE_GENERATIVE_AI_API_KEY_2)
  // springt automatisch ein, wenn das Kontingent des ersten aufgebraucht ist.
  { key: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Google)', group: 'Google AI Studio', provider: 'google', id: 'gemini-3.8-flash' },
  { key: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro Preview (Google)', group: 'Google AI Studio', provider: 'google', id: 'gemini-3.1-pro-preview' },

  // --- OpenAI --------------------------------------------------------------------
  // Läuft nur mit Guthaben auf platform.openai.com. Ein zweiter Key
  // (OPENAI_API_KEY_2) springt ein, wenn das Guthaben des ersten leer ist.
  { key: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (OpenAI)', group: 'OpenAI', provider: 'openai', id: 'gpt-6.1-sol' },
  { key: 'gpt-6-astra', label: 'GPT-6 Astra (OpenAI)', group: 'OpenAI', provider: 'openai', id: 'gpt-6-astra' },
  { key: 'gpt-6-luna', label: 'GPT-6 Luna (OpenAI)', group: 'OpenAI', provider: 'openai', id: 'gpt-6-luna' },

  // --- Groq (kostenloses Kontingent) -------------------------------------------------
  { key: 'groq-gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', group: 'Groq (Fast)', provider: 'groq', id: 'openai/gpt-oss-120b' },
  { key: 'groq-gpt-oss-20b', label: 'GPT-OSS 20B (Groq, sehr schnell)', group: 'Groq (Fast)', provider: 'groq', id: 'openai/gpt-oss-20b' },

  // --- Cohere (Trial-Key ist kostenlos, mit Limits) ---------------------------------------
  { key: 'cohere-command-a', label: 'Command A (Cohere)', group: 'Cohere', provider: 'cohere', id: 'command-a-03-2025' },
  { key: 'cohere-command-r-plus', label: 'Command R+ 08-2024 (Cohere)', group: 'Cohere', provider: 'cohere', id: 'command-r-plus-08-2024' },

  // --- OpenRouter (Gratis) -------------------------------------------------------------
  // Alle IDs enden auf ":free" und kosten nichts. Limits: 20 Anfragen pro Minute
  // und 50 pro Tag (1000 pro Tag, sobald du einmalig 10 $ Guthaben gekauft hast).
  // Gratis-Modelle wechseln oft. Verschwindet eines, meldet OpenRouter
  // "No endpoints found": dann die ID in der Liste unten korrigieren.
  // "openrouter/free" ist ein Router, der selbst ein gerade verfügbares
  // Gratis-Modell wählt und deshalb nicht veraltet.
  { key: 'openrouter-free-router', label: 'Free Router (wählt automatisch)', group: 'OpenRouter (Gratis)', provider: 'openrouter', id: 'openrouter/free' },
  { key: 'openrouter-nemotron-ultra', label: 'Nemotron 3 Ultra 550B', group: 'OpenRouter (Gratis)', provider: 'openrouter', id: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
  { key: 'openrouter-nemotron-super', label: 'Nemotron 3 Super 120B', group: 'OpenRouter (Gratis)', provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free' },
  { key: 'openrouter-gpt-oss-120b', label: 'GPT-OSS 120B', group: 'OpenRouter (Gratis)', provider: 'openrouter', id: 'openai/gpt-oss-120b:free' },
  { key: 'openrouter-gemma-4-31b', label: 'Gemma 4 31B (Google)', group: 'OpenRouter (Gratis)', provider: 'openrouter', id: 'google/gemma-4-31b-it:free' },
  { key: 'openrouter-qwen3-coder', label: 'Qwen3 Coder (Programmieren)', group: 'OpenRouter (Gratis)', provider: 'openrouter', id: 'qwen/qwen3-coder:free' },
  { key: 'openrouter-qwen3-next', label: 'Qwen3 Next 80B', group: 'OpenRouter (Gratis)', provider: 'openrouter', id: 'qwen/qwen3-next-80b-a3b-instruct:free' },

  // --- Werkzeuge -----------------------------------------------------------------------
  // Kein Sprachmodell: Der Server baut aus dem Text eine Pollinations-Bild-URL.
  { key: 'pollinations-image', label: 'Bildgenerierung (Pollinations)', group: 'Tools', provider: 'image', id: 'pollinations' },
] as const satisfies readonly ModelDefinition[];

/** Union aller gültigen Schlüssel, z. B. 'gemini-3.8-flash' | 'gpt-6-astra' | ... */
export type ModelKey = (typeof MODELS)[number]['key'];

/** Modell, das beim Start vorausgewählt ist. */
export const DEFAULT_MODEL: ModelKey = 'gemini-3.8-flash';

/** Schlüssel des Bildmodells. Die Oberfläche ändert damit den Platzhaltertext. */
export const IMAGE_MODEL: ModelKey = 'pollinations-image';

/**
 * Sucht einen Eintrag anhand des Schlüssels.
 * Parameter ist absichtlich `unknown`, weil der Wert aus einer Anfrage von außen
 * kommt und alles Mögliche sein könnte. Gibt `undefined` zurück, wenn es das
 * Modell nicht gibt.
 */
export function findModel(key: unknown): ModelDefinition | undefined {
  return MODELS.find((model) => model.key === key);
}

/**
 * Gruppiert die Liste nach `group`, in der Reihenfolge des ersten Auftretens.
 * Das Dropdown nutzt das für die <optgroup>-Überschriften.
 */
export function getModelGroups(): { group: string; models: ModelDefinition[] }[] {
  const groups: { group: string; models: ModelDefinition[] }[] = [];

  for (const model of MODELS) {
    const existing = groups.find((entry) => entry.group === model.group);

    if (existing) {
      existing.models.push(model);
    } else {
      groups.push({ group: model.group, models: [model] });
    }
  }

  return groups;
}
