import { MAX_RUN_SECONDS } from '@cardstack/runtime-common/automation-declaration';
import { CREDENTIAL_PREFIXES } from '@cardstack/runtime-common/credential-prefixes';

// An automation run's time limit: its `seconds` cap, never more than
// `MAX_RUN_SECONDS` (20 minutes). It takes the place of the interactive
// surface's 100-second deadline, and bounds everything the script does,
// waiting on realm calls included.
export function automationTimeLimitMs(secondsCap: number): number {
  if (!Number.isFinite(secondsCap) || secondsCap <= 0) {
    throw new Error(
      `An automation run's seconds cap must be more than 0, not ${secondsCap}`,
    );
  }
  return Math.min(secondsCap, MAX_RUN_SECONDS) * 1000;
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

// What an automation run reports while it runs, in the order it happens.
// `at` is the time it was reported, in ms since the epoch. Every text in an
// event has been through `redactSecrets`.
export type RunProgressEvent =
  | { kind: 'activity'; at: number; line: string }
  // the milestones the script means to pass, in order
  | { kind: 'plan'; at: number; milestones: string[] }
  // the milestone the script has reached
  | { kind: 'milestone'; at: number; name: string }
  // how far through the current milestone: `done` of `total`
  | { kind: 'count'; at: number; done: number; total?: number }
  // `line` is the script's own line number, when QuickJS reports one
  | {
      kind: 'console';
      at: number;
      level: ConsoleLevel;
      message: string;
      line?: number;
    };

// Where an automation run's progress goes in place of a chat. The run record
// keeps it: the console shows it live, and the run log persists it.
export interface RunProgressSink {
  record(event: RunProgressEvent): void;
}

export const REDACTED = '[REDACTED]';

// A registered secret shorter than this is too likely to occur by chance in
// ordinary text to be worth removing.
const MIN_SECRET_LENGTH = 8;

const KEY_CHARS = '[A-Za-z0-9_\\-]';

// The names a credential goes by in a JSON field or a query parameter.
const SECRET_NAMES =
  'password|passwd|secret|client_secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|token|private[_-]?key|signature|sig';

// Credentials recognized wherever they come from. A match is replaced with
// `REDACTED`, except its `keep` group, which stays so the line still says
// what was there:
// - by shape: a vendor key (its fixed prefix and a key-like tail), a JWT such
//   as a realm session or a run token, a `Bearer` token, an AWS access key
//   id, and a PEM private key;
// - by name: the value of an `Authorization` header, and of a JSON field or
//   query parameter named like a credential (`"api_key": "…"`, `?token=…`).
//
// `Bearer` is matched only as written, so prose such as "bearer of" stays.
const CREDENTIAL_PATTERNS: RegExp[] = [
  new RegExp(
    `(?<![A-Za-z0-9])(?:${CREDENTIAL_PREFIXES.map(escapeRegExp).join('|')})${KEY_CHARS}{10,}`,
    'g',
  ),
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
  /(?<keep>\bAuthorization["']?\s*[:=]\s*["']?(?:[A-Za-z]+\s+)?)[A-Za-z0-9._~+/=-]{8,}/gi,
  /(?<keep>\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g,
  new RegExp(`(?<keep>"(?:${SECRET_NAMES})"\\s*:\\s*")[^"\\\\]{4,}(?=")`, 'gi'),
  new RegExp(`(?<keep>[?&](?:key|${SECRET_NAMES})=)[^&#\\s"']{4,}`, 'gi'),
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replaces each secret in `text` with `REDACTED`: every value in `secrets`
// (the run's own token, say) wherever it appears, and every credential
// `CREDENTIAL_PATTERNS` recognizes.
export function redactSecrets(
  text: string,
  secrets: readonly string[] = [],
): string {
  let redacted = text;
  for (let secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= MIN_SECRET_LENGTH) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }
  for (let pattern of CREDENTIAL_PATTERNS) {
    redacted = redacted.replace(pattern, (...match) => {
      let groups = match[match.length - 1] as { keep?: string } | string;
      return `${typeof groups === 'object' ? (groups.keep ?? '') : ''}${REDACTED}`;
    });
  }
  return redacted;
}
