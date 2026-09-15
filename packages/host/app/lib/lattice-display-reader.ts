import {
  CardError,
  SupportedMimeType,
  isJsonContentType,
  isCardError,
} from '@cardstack/runtime-common';
import {
  LATTICE_DISPLAY_BATCH_SIZE,
  latticeDisplayBatchRequest,
  latticeDisplayBatchResults,
  type LatticeDisplayBatchResult,
} from '@cardstack/runtime-common/lattice-display';

// Distinguish an unavailable read from a failure while applying executable
// card data. Only the former can retain an already admitted pending display.
export class LatticeDisplayReadError extends CardError {}

type Publication = Extract<
  LatticeDisplayBatchResult,
  { publication: unknown }
>['publication'];
interface Read {
  realm: string;
  url: string;
  have: () => string | undefined;
  current: () => boolean;
  signal?: AbortSignal;
}
interface Pending extends Read {
  finish: (value?: Publication, error?: unknown) => void;
  cancel: () => void;
  batch?: { controller: AbortController; entries: Pending[] };
}

// Transport for already admitted reads, not a second scheduler or card cache.
// The Store owns concurrency, card identity, freshness and application.
export default class LatticeDisplayReader {
  private session = crypto.randomUUID();
  private epoch = 0;
  private queued = new Map<string, Pending[]>();
  private pending = new Set<Pending>();

  constructor(
    private fetch: (url: string, init: RequestInit) => Promise<Response>,
    private canonicalize: (id: string) => string,
  ) {}

  read(read: Read): Promise<Publication | undefined> {
    return new Promise((resolve, reject) => {
      let entry: Pending = {
        ...read,
        finish: (value, error) => {
          if (!this.pending.delete(entry)) return;
          entry.signal?.removeEventListener('abort', entry.cancel);
          if (error) reject(error);
          else resolve(value);
        },
        cancel: () => {
          entry.finish(
            undefined,
            new DOMException('Display read cancelled', 'AbortError'),
          );
          if (entry.batch?.entries.every((peer) => !this.pending.has(peer)))
            entry.batch.controller.abort();
        },
      };
      this.pending.add(entry);
      if (entry.signal?.aborted) {
        entry.cancel();
        return;
      }
      entry.signal?.addEventListener('abort', entry.cancel, { once: true });
      let queue = this.queued.get(read.realm);
      if (!queue) {
        queue = [];
        this.queued.set(read.realm, queue);
        queueMicrotask(() => this.dispatch(read.realm, queue!));
      }
      queue.push(entry);
    });
  }

  reset() {
    this.epoch++;
    this.queued.clear();
    for (let entry of this.pending) entry.cancel();
  }

  private dispatch(realm: string, queue: Pending[]) {
    if (this.queued.get(realm) !== queue) return;
    this.queued.delete(realm);
    let entries = queue.filter((entry) => {
      if (!this.pending.has(entry)) return false;
      if (entry.current()) return true;
      entry.finish();
      return false;
    });
    for (let i = 0; i < entries.length; i += LATTICE_DISPLAY_BATCH_SIZE)
      void this.exchange(
        realm,
        entries.slice(i, i + LATTICE_DISPLAY_BATCH_SIZE),
      );
  }

  private async exchange(realm: string, entries: Pending[]) {
    let epoch = this.epoch;
    let batch = { controller: new AbortController(), entries };
    for (let entry of entries) entry.batch = batch;
    try {
      let request = latticeDisplayBatchRequest(
        {
          version: 1,
          session: this.session,
          epoch,
          required: entries.map((entry) => entry.url),
          have: entries.flatMap((entry) => {
            let token = entry.have();
            return token ? [{ url: entry.url, token }] : [];
          }),
        },
        realm,
      );
      let response = await this.fetch(`${realm}_lattice-read`, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
          'X-HTTP-Method-Override': 'QUERY',
        },
        body: JSON.stringify(request),
        signal: batch.controller.signal,
      });
      if (!response.ok) {
        // An endpoint failure says nothing about any required card's existence.
        throw new CardError(
          `Lattice display request failed (${response.status})`,
          {
            status:
              response.status === 404 || response.status === 409
                ? 502
                : response.status,
          },
        );
      }
      let authority = response.headers.get('x-boxel-realm-url');
      if (
        !authority ||
        this.canonicalize(authority) !== realm ||
        !isJsonContentType(response.headers.get('content-type'))
      ) {
        throw new CardError(
          'Invalid Lattice display serving realm or content type',
          { status: 502 },
        );
      }
      let results = latticeDisplayBatchResults(
        await response.json(),
        request,
        this.canonicalize,
      );
      if (epoch !== this.epoch) return;
      for (let entry of entries) {
        let result = results.get(entry.url)!;
        if ('error' in result) {
          entry.finish(
            undefined,
            new LatticeDisplayReadError(result.error.message, {
              status: result.error.status,
            }),
          );
        } else {
          entry.finish(result.publication);
        }
      }
    } catch (error) {
      let failure = new LatticeDisplayReadError(
        error instanceof Error ? error.message : 'Lattice display read failed',
        { status: isCardError(error) ? error.status : 502 },
      );
      for (let entry of entries) entry.finish(undefined, failure);
    }
  }
}
