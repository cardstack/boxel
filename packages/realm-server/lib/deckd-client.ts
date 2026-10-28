import { join } from 'path';
import {
  HISTORY_DIR,
  HistoryBackendError,
  type HistoryBackend,
  type HistoryCommitRequest,
  type HistoryCommitResult,
  type HistoryOutcome,
  type PreparedCommit,
  type HistoryReadResult,
  type HistoryTreeEntry,
} from '@cardstack/runtime-common/realm-history';

// How long a call to deckd may take before its outcome is treated as unknown.
// deckd gives up waiting for its own repo lock at 30 s and answers
// `lock-timeout`, so a call still unanswered past that has lost its response
// rather than queued behind another writer.
const DECKD_CALL_TIMEOUT_MS = 35_000;

// deckd's history API for one realm's repository, at `<realm>/.realm-history`.
// deckd creates the repository on first use. Every call names the repository
// by its absolute path, so one deckd serves every realm on its filesystem.
//
// A typed refusal comes back as a `HistoryBackendError` carrying deckd's
// `code`. Anything else — a timeout, a reset connection, an answer deckd
// didn't shape — rejects with the transport's own error, which the recorder
// treats as an unknown outcome and resolves by asking for it.
export class DeckdHistoryBackend implements HistoryBackend {
  readonly repo: string;
  #url: string;
  #timeoutMs: number;

  constructor({
    deckdURL,
    realmDir,
    timeoutMs = DECKD_CALL_TIMEOUT_MS,
  }: {
    deckdURL: string;
    realmDir: string;
    timeoutMs?: number;
  }) {
    this.#url = deckdURL.replace(/\/+$/, '');
    this.repo = join(realmDir, HISTORY_DIR);
    this.#timeoutMs = timeoutMs;
  }

  // The body is encoded once, here, with every field but `parent`. Sending it
  // writes `parent` in front of the encoded rest, so a resend under a new
  // parent encodes nothing again.
  prepareCommit(request: Omit<HistoryCommitRequest, 'parent'>): PreparedCommit {
    let rest = JSON.stringify({
      repo: this.repo,
      operationId: request.operationId,
      author: request.author,
      message: request.message,
      trailers: request.trailers,
      changes: request.changes.map((change) =>
        change.delete
          ? { path: change.path, delete: true }
          : {
              path: change.path,
              contentBase64: Buffer.from(change.content ?? []).toString(
                'base64',
              ),
            },
      ),
    });
    return {
      commit: async (parent: string): Promise<HistoryCommitResult> => {
        let body = await this.#send(
          '/commit',
          `{"parent":${JSON.stringify(parent)},${rest.slice(1)}`,
        );
        return {
          revision: String(body.revision),
          parent: parentOf(body, '/commit'),
          created: Boolean(body.created),
          replayed: Boolean(body.replayed),
        };
      },
    };
  }

  async outcome(operationId: string): Promise<HistoryOutcome> {
    let body = await this.#post('/outcome', { repo: this.repo, operationId });
    if (body.state === 'committed') {
      return {
        state: 'committed',
        revision: String(body.revision),
        parent: parentOf(body, '/outcome'),
        created: Boolean(body.created),
      };
    }
    if (body.state === 'absent') {
      return { state: 'absent' };
    }
    throw new Error(`deckd answered /outcome with state ${body.state}`);
  }

  async head(): Promise<string> {
    let body = await this.#post('/head', { repo: this.repo });
    return String(body.revision);
  }

  async tree(revision: string): Promise<HistoryTreeEntry[]> {
    let body = await this.#post('/tree', { repo: this.repo, revision });
    return (body.entries as { path: string; blob: string }[]).map(
      ({ path, blob }) => ({ path: String(path), blob: String(blob) }),
    );
  }

  async read(revision: string, paths: string[]): Promise<HistoryReadResult> {
    let body = await this.#post('/read', {
      repo: this.repo,
      revision,
      paths,
    });
    return {
      files: (
        body.files as {
          path: string;
          contentBase64?: string;
          absent?: boolean;
        }[]
      ).map((file) =>
        file.absent || file.contentBase64 === undefined
          ? { path: String(file.path) }
          : {
              path: String(file.path),
              content: new Uint8Array(
                Buffer.from(file.contentBase64, 'base64'),
              ),
            },
      ),
      remaining: (body.remaining as string[] | undefined) ?? [],
    };
  }

  async #post(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    return await this.#send(endpoint, JSON.stringify(payload));
  }

  async #send(endpoint: string, json: string): Promise<Record<string, any>> {
    let response = await fetch(`${this.#url}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    let text = await response.text();
    let body: Record<string, any> | undefined;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (response.ok && body) {
      return body;
    }
    if (body && typeof body.code === 'string') {
      throw new HistoryBackendError(
        body.code,
        response.status,
        `deckd ${endpoint} ${response.status} ${body.code}: ${body.error ?? ''}`,
        {
          ...(typeof body.head === 'string' ? { head: body.head } : {}),
          ...(typeof body.revision === 'string'
            ? { revision: body.revision }
            : {}),
        },
      );
    }
    throw new Error(
      `deckd ${endpoint} answered ${response.status}: ${text.slice(0, 200)}`,
    );
  }
}

// A revision's parent as deckd answered it: null only for the root commit. A
// deckd that leaves it out predates reporting it, and the journal can't be
// kept in history order without it.
function parentOf(
  body: Record<string, unknown>,
  endpoint: string,
): string | undefined {
  if (!('parent' in body)) {
    throw new Error(
      `deckd answered ${endpoint} without the revision's parent; it is older than this realm server needs`,
    );
  }
  return body.parent == null ? undefined : String(body.parent);
}
