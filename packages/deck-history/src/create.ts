import { DeckdHistory } from './deckd.ts';
import type { HistoryBackend } from './backend.ts';

// Every-save History attaches through deckd only. The old jj-cli fork path competed with
// deckd's FS watcher, sealed `.deck/**` into the tape, and is gone.
//
// Attaching history is still OPTIONAL and never fatal: when deckd is down the
// caller keeps the Versions loop — same watcher, same store, no seals.

export type HistoryKind = 'auto' | 'deckd' | 'none';

export interface CreateHistoryOptions {
  dir: string;
  kind?: HistoryKind;
  debounceMs?: number;
  baseUrl?: string;
  onError?: (error: unknown) => void;
}

export interface HistoryAttachment {
  backend?: HistoryBackend;
  tier: 1 | 2;
  detail: string;
}

export function isValidHistoryKind(value: string): value is HistoryKind {
  return ['auto', 'deckd', 'none'].includes(value);
}

export function daemonBaseUrl(explicit?: string): string | undefined {
  return explicit ?? process.env.DECKD_URL ?? undefined;
}

export async function createHistory(
  options: CreateHistoryOptions,
): Promise<HistoryAttachment> {
  let { dir, kind = 'auto', debounceMs, baseUrl, onError } = options;

  if (kind === 'none') {
    return { tier: 1, detail: 'history off — the store is the history' };
  }

  // auto / deckd → one client, one daemon.
  let resolvedUrl = daemonBaseUrl(baseUrl) ?? 'http://127.0.0.1:8787';
  let daemon = new DeckdHistory({
    baseUrl: resolvedUrl,
    debounceMs,
    onError,
  });
  if (await daemon.probe(dir)) {
    return {
      backend: daemon,
      tier: 2,
      detail: `history: deckd at ${daemon.baseUrl} — a Step per save`,
    };
  }
  daemon.close();
  return {
    tier: 1,
    detail: `history: no deckd at ${resolvedUrl} — Version history only (start packages/deckd for every-save History)`,
  };
}
