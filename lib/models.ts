/**
 * lib/models.ts
 * =============================================================================
 * Zentrale Modellliste der App.
 * Stand: 18.11.2026
 * Hinweis: Gratis-Modelle (vor allem bei OpenRouter) verschwinden oft. Meldet
 * ein Modell "No endpoints found", Eintrag hier löschen.
 * =============================================================================
 */

export type ProviderName =
  | 'google'
  | 'openai'
  | 'groq'
  | 'cohere'
  | 'openrouter'
  | 'nvidia'
  | 'cloudflare'
  | 'image';

export interface ModelDefinition {
  key: string;
  label: string;
  group: string;
  provider: ProviderName;
  id: string;
  /** true = Free-Tier / Rate-Limits, false = bezahlt */
  isFree: boolean;
  /** versteht Bilder */
  vision?: boolean;
  /** versteht Videos (nur sehr kleine Clips, siehe Größenlimit) */
  video?: boolean;
}

export const MODELS = [
  // --- Google AI Studio -------------------------------------------------------
  {
    key: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite (Google)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.5-flash-lite',
    isFree: true,
    vision: true,
    video: true,
  },
  {
    key: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite (Google)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.1-flash-lite',
    isFree: true,
    vision: true,
    video: true,
  },
  {
    key: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash (Google)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.6-flash',
    isFree: true,
    vision: true,
    video: true,
  },
  {
    key: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash (Google, Free-Tier oft überlastet)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.8-flash',
    isFree: true,
    vision: true,
    video: true,
  },
  {
    key: 'gemini-3.1-pro',
    label: 'Gemini 3.1 Pro Preview (Google)',
    group: 'Google AI Studio',
    provider: 'google',
    id: 'gemini-3.1-pro-preview',
    isFree: false,
    vision: true,
    video: true,
  },

  // --- OpenAI (bezahlt) -------------------------------------------------------
  {
    key: 'gpt-6-luna',
    label: 'GPT-6 Luna (OpenAI) – günstig',
    group: 'OpenAI',
    provider: 'openai',
    id: 'gpt-6-luna',
    isFree: false,
    vision: true,
  },
  {
    key: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol (OpenAI)',
    group: 'OpenAI',
    provider: 'openai',
    id: 'gpt-6.1-sol',
    isFree: false,
    vision: true,
  },
  {
    key: 'gpt-6-astra',
    label: 'GPT-6 Astra (OpenAI) – teuer',
    group: 'OpenAI',
    provider: 'openai',
    id: 'gpt-6-astra',
    isFree: false,
    vision: true,
  },

  // --- Groq -------------------------------------------------------------------
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
    isFree: true,
  },

  // --- NVIDIA NIM (Gratis, braucht NVIDIA_API_KEY) -----------------------------
  // Nur Modelle mit "Free Endpoint" im Katalog auf build.nvidia.com. Abgeschaltete
  // Modelle melden HTTP 410, dann Eintrag löschen.
  {
    key: 'nvidia-nemotron-ultra',
    label: 'Nemotron 3 Ultra 550B (NVIDIA)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    isFree: true,
  },
  {
    key: 'nvidia-nemotron-35-lightning',
    label: 'Nemotron 3.5 Lightning 30B (NVIDIA, schnell)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    isFree: true,
  },
  {
    key: 'nvidia-nemotron-35-super-vl',
    label: 'Nemotron 3.5 Super 120B (NVIDIA)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    isFree: true,
    vision: true,
  },
  {
    key: 'nvidia-minimax-m31-flash',
    label: 'MiniMax M3.1 Flash (NVIDIA, Coding)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'minimaxai/minimax-m3.1-flash',
    isFree: true,
  },
  {
    key: 'nvidia-kimi-k31-pro',
    label: 'Kimi K3.1 Pro (NVIDIA, Coding)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'moonshotai/kimi-k3.1-pro',
    isFree: true,
  },
  {
    key: 'nvidia-glm-53-flash',
    label: 'GLM 5.3 Flash (NVIDIA)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'z-ai/glm-5-3-flash',
    isFree: true,
  },
  {
    key: 'nvidia-laguna-xs-21',
    label: 'Laguna XS 2.1 (NVIDIA, Coding-Agent)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'poolside/laguna-xs-2.1',
    isFree: true,
  },
  {
    key: 'nvidia-gemma-4-31b',
    label: 'Gemma 4 31B (NVIDIA)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'google/gemma-4-31b-it',
    isFree: true,
  },
  {
    key: 'nvidia-muse-glimmer-30b',
    label: 'Muse Glimmer 30B (NVIDIA)',
    group: 'NVIDIA NIM (Gratis)',
    provider: 'nvidia',
    id: 'meta/muse-glimmer-30b',
    isFree: true,
    vision: true,
  },

  // --- Cloudflare Workers AI (Gratis, braucht CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
  {
    key: 'cloudflare-llama-4-scout',
    label: 'Llama 4 Scout (Cloudflare)',
    group: 'Cloudflare Workers AI (Gratis)',
    provider: 'cloudflare',
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    isFree: true,
  },
  {
    key: 'cloudflare-gpt-oss-120b',
    label: 'GPT-OSS 120B (Cloudflare)',
    group: 'Cloudflare Workers AI (Gratis)',
    provider: 'cloudflare',
    id: '@cf/openai/gpt-oss-120b',
    isFree: true,
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
    key: 'openrouter-nemotron-35-super-vl',
    label: 'Nemotron 3.5 Super VL (Bild + Text)',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'nvidia/nemotron-3.5-super-vl:free',
    isFree: true,
    vision: true,
  },
  {
    key: 'openrouter-nemotron-35-lightning',
    label: 'Nemotron 3.5 Lightning (schnell, 1M Kontext)',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'nvidia/nemotron-3.5-lightning:free',
    isFree: true,
  },
  {
    key: 'openrouter-north-mini-code',
    label: 'North Mini Code (Cohere, Coding)',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'cohere/north-mini-code:free',
    isFree: true,
  },
  {
    key: 'openrouter-flint',
    label: 'Flint v1.0 (Coding-Agenten)',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'recursive/flint-v1.0:free',
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
    key: 'openrouter-gemma-4-26b',
    label: 'Gemma 4 26B A4B (Google)',
    group: 'OpenRouter (Gratis)',
    provider: 'openrouter',
    id: 'google/gemma-4-26b-a4b-it:free',
    isFree: true,
  },

  // --- Tools ------------------------------------------------------------------
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

// Standardmodell: schnell und im Free-Tier zuverlässig
export const DEFAULT_MODEL: ModelKey = 'gemini-3.5-flash-lite';
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
