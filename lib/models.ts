/**
 * lib/models.ts
 * =============================================================================
 * Zentrale Modellliste der App.
 * Stand: 20.10.2026
 * =============================================================================
 */

export type ProviderName =
  | 'google'
  | 'openai'
  | 'groq'
  | 'cohere'
  | 'openrouter'
  | 'image';

export interface ModelDefinition {
  key: string;
  label: string;
  group: string;
  provider: ProviderName;
  id: string;
  /** true = Free-Tier / Rate-Limits, false = bezahlt / unlimitiert (wenn Guthaben da) */
  isFree: boolean;
}

export const MODELS = [
  // --- Google AI Studio (Free-Tier vorhanden) ---------------------------------
  {
    key: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash (Google)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.8-flash',
    isFree: true,
  },
  {
    key: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite (Google)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.5-flash-lite',
    isFree: true,
  },
  {
    key: 'gemini-3.1-pro',
    label: 'Gemini 3.1 Pro Preview (Google)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.1-pro-preview',
    isFree: false, // meist bezahlt
  },

  // --- OpenAI (immer bezahlt) -------------------------------------------------
  {
    key: 'gpt-6-luna',
    label: 'GPT-6 Luna (OpenAI) – günstig',
    group: 'OpenAI',
    provider: 'openai',
    id: 'gpt-6-luna',
    isFree: false,
  },
  {
    key: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol (OpenAI)',
    group: 'OpenAI',
    provider: 'openai',
    id: 'gpt-6.1-sol',
    isFree: false,
  },
  {
    key: 'gpt-6-astra',
    label: 'GPT-6 Astra (OpenAI) – teuer',
    group: 'OpenAI',
    provider: 'openai',
    id: 'gpt-6-astra',
    isFree: false,
  },

  // --- Groq (Free-Tier + sehr schnell) ----------------------------------------
  {
    key: 'groq-gpt-oss-20b',
    label: 'GPT-OSS 20B (Groq, sehr schnell)',
    group: 'Groq (Fast)',
    provider: 'groq',
    id: 'openai/gpt-oss-20b',
    isFree: true,
  },
  {
    key: 'groq-gpt-oss-120b',
    label: 'GPT-OSS 120B (Groq)',
    group: 'Groq (Fast)',
    provider: 'groq',
    id: 'openai/gpt-oss-120b',
    isFree: true,
  },

  // --- Cohere -----------------------------------------------------------------
  {
    key: 'cohere-command-a',
    label: 'Command A (Cohere)',
    group: 'Cohere',
    provider: 'cohere',
    id: 'command-a-03-2025',
    isFree: true, // Trial/Free-Tier
  },

  // --- OpenRouter Free --------------------------------------------------------
  {
    key: 'openrouter-free-router',
    label: 'Free Router (wählt automatisch)',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'openrouter/free',
    isFree: true,
  },
  {
    key: 'openrouter-nemotron-ultra',
    label: 'Nemotron 3 Ultra 550B',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    isFree: true,
  },
  {
    key: 'openrouter-nemotron-super',
    label: 'Nemotron 3 Super 120B',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    isFree: true,
  },
  {
    key: 'openrouter-gemma-4-31b',
    label: 'Gemma 4 31B (Google)',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'google/gemma-4-31b-it:free',
    isFree: true,
  },
  {
    key: 'openrouter-minimax-flash',
    label: 'MiniMax M3.1 Flash',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'minimax/minimax-m3.1-flash:free',
    isFree: true,
  },

  // --- Werkzeuge --------------------------------------------------------------
  {
    key: 'pollinations-image',
    label: 'Bildgenerierung (Pollinations)',
    group: 'Tools',
    provider: 'image',
    id: 'pollinations',
    isFree: true,
  },
] as const satisfies readonly ModelDefinition[];

export type ModelKey = (typeof MODELS)[number]['key'];

export const DEFAULT_MODEL: ModelKey = 'gemini-3.8-flash';
export const IMAGE_MODEL: ModelKey = 'pollinations-image';

export function findModel(key: unknown): ModelDefinition | undefined {
  return MODELS.find((model) => model.key === key);
}

export function getModelGroups(onlyFree = false): {
  group: string;
  models: ModelDefinition[];
}[] {
  const groups: { group: string; models: ModelDefinition[] }[] = [];

  for (const model of MODELS) {
    if (onlyFree && !model.isFree) continue;

    const existing = groups.find((entry) => entry.group === model.group);
    if (existing) {
      existing.models.push(model);
    } else {
      groups.push({ group: model.group, models: [model] });
    }
  }

  return groups;
}