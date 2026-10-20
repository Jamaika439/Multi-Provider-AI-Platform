/**
 * lib/failover-fetch.ts
 * =============================================================================
 * Automatischer Wechsel auf einen zweiten (dritten ...) API-Key.
 *
 * Idee: Alle Anbieter-Bibliotheken schicken ihre Anfragen über eine `fetch`-
 * Funktion. Wir geben ihnen eine eigene, die so arbeitet:
 *
 *   1. Anfrage mit Key 1 abschicken.
 *   2. Lehnt der Anbieter wegen Guthaben, Kontingent oder Key ab, dieselbe
 *      Anfrage mit Key 2 wiederholen, dann mit Key 3.
 *   3. Gibt es keinen weiteren Key, wird die Fehlerantwort weitergereicht. Die
 *      Fehlermeldung enthält dann eine Liste, welcher Key mit welchem Status
 *      abgelehnt wurde ("Key-Versuche: ..."), damit man sofort sieht, was los war.
 *
 * Wann wird gewechselt?
 *   - bei HTTP 401, 402, 403 oder 429 (Key ungültig, Guthaben leer, verboten,
 *     Limit erreicht), ODER
 *   - bei anderen Fehlern im 4xx-Bereich (z. B. 400), wenn der Text der Antwort
 *     nach Key-, Guthaben- oder Kontingentproblem klingt (manche Anbieter
 *     melden das mit HTTP 400).
 *   Andere Fehler (z. B. 404 "Modell nicht gefunden" oder 500) lösen KEINEN
 *   Wechsel aus: Ein zweiter Key würde daran nichts ändern.
 *
 * Wichtig zu wissen: Ein Wechsel hilft nur, wenn der nächste Key wirklich ein
 * eigenes Guthaben oder Kontingent hat. Bei Google gilt das Kontingent pro
 * PROJEKT. Zwei Keys aus demselben Projekt teilen sich also dasselbe Limit.
 *
 * Ein abgelehnter Key wird für COOLDOWN_MS übersprungen, damit nicht jede
 * Anfrage erst an den leeren Key geht. Danach wird er wieder probiert.
 * =============================================================================
 */

/** Ein API-Key samt dem Namen der Umgebungsvariable (für Log-Meldungen, nie der Key selbst). */
export interface FailoverKey {
  name: string;
  value: string;
}

/** HTTP-Statuscodes, bei denen ein anderer Key helfen kann. */
const FAILOVER_STATUS = new Set([401, 402, 403, 429]);

/**
 * Wörter in einer Fehlerantwort, die auf ein Key-, Guthaben- oder
 * Kontingentproblem hindeuten. Wird nur bei 4xx-Fehlern geprüft, die nicht
 * schon in FAILOVER_STATUS stehen (z. B. HTTP 400 bei ungültigem Google-Key).
 */
const KEY_PROBLEM_PATTERN =
  /credit|quota|billing|insufficient|exhaust|rate[\s_-]?limit|too many requests|unauthori[sz]ed|api[\s_-]?key|permission|not have access|access denied/i;

/** So lange wird ein abgelehnter Key übersprungen (5 Minuten). */
const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Merkliste "Key -> gesperrt bis (Zeitstempel)". Hängt an globalThis, damit sie
 * den Hot Reload im Dev-Modus übersteht (siehe lib/db.ts für dieselbe Technik).
 */
const globalState = globalThis as unknown as {
  __keyCooldowns?: Map<string, number>;
};

function getCooldowns(): Map<string, number> {
  if (!globalState.__keyCooldowns) {
    globalState.__keyCooldowns = new Map();
  }

  return globalState.__keyCooldowns;
}

interface FailoverOptions {
  /** Name des Anbieters, nur für Log-Meldungen und die Merkliste. */
  provider: string;
  /** Alle Keys in Reihenfolge der Priorität. Key 1 wird zuerst benutzt. */
  keys: FailoverKey[];
  /** Setzt den Key in die Header. Anbieter unterscheiden sich hier. */
  applyKey: (headers: Headers, key: string) => void;
}

/** Ein einzelner Versuch: welcher Key, welcher HTTP-Status. */
interface Attempt {
  name: string;
  status: number;
}

/** Macht aus den Versuchen einen lesbaren Satz, z. B. "Key-Versuche: A → HTTP 429, B → HTTP 429". */
function describeAttempts(attempts: Attempt[]): string {
  const list = attempts
    .map((attempt) => `${attempt.name} → HTTP ${attempt.status}`)
    .join(', ');

  return attempts.length > 1 ? `Key-Versuche: ${list}` : `Key: ${list}`;
}

/**
 * Baut aus einer Fehlerantwort eine neue, bei der die Versuchsliste an die
 * Fehlermeldung angehängt ist. Dadurch sieht der Nutzer im Chat, welche Keys
 * probiert wurden. Key-Werte, die im Antworttext vorkommen, werden unkenntlich
 * gemacht. Lässt sich die Meldung nicht finden, bleibt die Antwort unverändert.
 */
async function annotateError(
  response: Response,
  summary: string,
  secrets: string[]
): Promise<Response> {
  let raw = await response.text();

  // Nur echte Keys maskieren. Sehr kurze Werte (unter 8 Zeichen) sind keine
  // echten Keys und würden sonst beliebige Textstellen verstümmeln.
  for (const secret of secrets) {
    if (secret.length >= 8) {
      raw = raw.split(secret).join('***');
    }
  }

  let body = `${raw} [${summary}]`;

  try {
    const json = JSON.parse(raw);

    if (json?.error && typeof json.error === 'object' && typeof json.error.message === 'string') {
      // OpenAI, Google, Groq, OpenRouter: {"error": {"message": "..."}}
      json.error.message = `${json.error.message} [${summary}]`;
      body = JSON.stringify(json);
    } else if (typeof json?.message === 'string') {
      // Cohere: {"message": "..."}
      json.message = `${json.message} [${summary}]`;
      body = JSON.stringify(json);
    }
  } catch {
    // Kein JSON: body bleibt "Rohtext [Zusammenfassung]".
  }

  // Der Text wurde verändert, also passen Länge und Kompression nicht mehr.
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');

  // Antwortet der Anbieter (oder eine Firewall) nicht mit JSON, zeigt die
  // KI-Bibliothek nur den HTTP-Statustext an, z. B. "Forbidden". Damit die
  // Versuchsliste auch dann im Chat erscheint, wird sie zusätzlich an den
  // Statustext gehängt. Dort sind nur einfache ASCII-Zeichen erlaubt.
  const asciiSummary = summary.replace(/→/g, '->').replace(/[^\x20-\x7E]/g, '');

  return new Response(body, {
    status: response.status,
    statusText: `${response.statusText} [${asciiSummary}]`.trim(),
    headers,
  });
}

/**
 * Erzeugt eine fetch-Funktion mit Key-Wechsel.
 */
export function createFailoverFetch({
  provider,
  keys,
  applyKey,
}: FailoverOptions): typeof fetch {
  const secrets = keys.map((key) => key.value);

  const failoverFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    const cooldowns = getCooldowns();
    const now = Date.now();
    const idOf = (key: FailoverKey) => `${provider}:${key.name}`;

    // Reihenfolge: erst alle Keys, die nicht gesperrt sind (in ihrer normalen
    // Priorität), zuletzt die gesperrten als letzte Möglichkeit.
    const available = keys.filter((key) => (cooldowns.get(idOf(key)) ?? 0) <= now);
    const cooling = keys.filter((key) => (cooldowns.get(idOf(key)) ?? 0) > now);
    const order = [...available, ...cooling];

    const attempts: Attempt[] = [];

    for (let index = 0; index < order.length; index++) {
      const key = order[index];
      const isLast = index === order.length - 1;

      const headers = new Headers(init?.headers);
      applyKey(headers, key.value);

      const response = await fetch(input, { ...init, headers });
      attempts.push({ name: key.name, status: response.status });

      if (response.ok) {
        return response;
      }

      // Soll der nächste Key probiert werden?
      let switchKey = FAILOVER_STATUS.has(response.status);

      if (
        !switchKey &&
        !isLast &&
        response.status >= 400 &&
        response.status < 500
      ) {
        // clone(): Der Text wird gelesen, die Originalantwort bleibt nutzbar.
        const text = await response
          .clone()
          .text()
          .catch(() => '');
        switchKey = KEY_PROBLEM_PATTERN.test(text);
      }

      if (!switchKey || isLast) {
        // Endgültiger Fehler: im Terminal festhalten und mit Versuchsliste zurückgeben.
        const summary = describeAttempts(attempts);
        console.warn(`[Key-Diagnose] ${provider}: Anfrage fehlgeschlagen. ${summary}`);

        return annotateError(response, summary, secrets);
      }

      // Key merken als abgelehnt, Antwort verwerfen, mit dem nächsten Key weitermachen.
      cooldowns.set(idOf(key), Date.now() + COOLDOWN_MS);
      console.warn(
        `[Key-Wechsel] ${provider}: ${key.name} wurde abgelehnt (HTTP ${response.status}), ` +
          `versuche ${order[index + 1].name}.`
      );
      await response.body?.cancel().catch(() => undefined);
    }

    // Nur erreichbar, wenn `keys` leer ist.
    throw new Error(`Für ${provider} ist kein API-Key konfiguriert.`);
  };

  return failoverFetch as typeof fetch;
}