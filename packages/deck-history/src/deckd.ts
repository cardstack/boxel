import {
  DirQueue,
  SealDebouncer,
  isValidHistoryPath,
  isValidRevisionId,
  type HistoryActor,
  type HistoryBackend,
  type HistoryEntry,
  type RestorePlan,
} from './backend.ts';

// The deckd backend: every-save History over localhost HTTP.
//
// Wire surface (POST, JSON in/out):
//   /ensure         {dir}                              → {}
//   /fork           {sourceDir, targetDir, revisionId,
//                    workspaceName}                    → {}
//   /discard        {dir}                               → {}
//   /seal           {dir, message, actor?}             → {changeId: string | null}
//   /list           {dir}                              → HistoryEntry[]
//   /file-at        {dir, revisionId, path}            → {found, contentBase64?}
//   /file-list-at   {dir, revisionId}                  → {paths}   (deckd; optional)
//   /restore-plan   {dir, revisionId}                  → {writes, deletes}
//
// packages/deckd speaks this complete contract. There is deliberately no
// compatibility negotiation inside Deck mode: a mismatched daemon is an
// error, never a silently reduced History implementation.

const DEFAULT_URL = 'http://127.0.0.1:8787';

export interface DeckdOptions {
  baseUrl?: string;
  debounceMs?: number;
  /** Standalone Deck watches the tree; Realm Server seals accepted writes. */
  watch?: boolean;
  onError?: (error: unknown) => void;
}

export class DeckdHistory implements HistoryBackend {
  readonly kind = 'deckd' as const;
  #base: string;
  #ensured: Set<string> = new Set();
  #queue = new DirQueue();
  #debouncer: SealDebouncer;
  #watch: boolean;

  constructor(options: DeckdOptions = {}) {
    this.#base = (
      options.baseUrl ??
      process.env.DECKD_URL ??
      DEFAULT_URL
    ).replace(/\/$/, '');
    this.#watch = options.watch ?? true;
    this.#debouncer = new SealDebouncer({
      debounceMs: options.debounceMs ?? 400,
      seal: (dir, message) => this.seal(dir, message),
      onError: options.onError,
    });
  }

  get baseUrl(): string {
    return this.#base;
  }

  async fork(
    sourceDir: string,
    targetDir: string,
    revisionId: string,
    workspaceName: string,
  ): Promise<void> {
    if (!isValidRevisionId(revisionId)) {
      throw new Error('invalid revision id');
    }
    if (!workspaceName || workspaceName === 'default') {
      throw new Error('invalid branch workspace name');
    }
    await this.#queue.run(sourceDir, async () => {
      await this.#ensure(sourceDir);
      await this.#post('/fork', {
        sourceDir,
        targetDir,
        revisionId,
        workspaceName,
      });
      this.#ensured.add(targetDir);
    });
  }

  async discard(dir: string): Promise<void> {
    this.#debouncer.take(dir);
    await this.#queue.run(dir, () => this.#post('/discard', { dir }));
    this.#ensured.delete(dir);
  }

  noteMutation(dir: string, path: string): void {
    this.#debouncer.note(dir, path);
  }

  async flush(dir: string): Promise<string | undefined> {
    return this.seal(dir, this.#debouncer.take(dir) ?? 'save');
  }

  async seal(
    dir: string,
    message: string,
    actor?: HistoryActor,
  ): Promise<string | undefined> {
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      let body: Record<string, unknown> = { dir, message };
      if (actor?.name) {
        body.actor = {
          name: actor.name,
          ...(actor.email ? { email: actor.email } : {}),
        };
      }
      let { changeId } = await this.#post<{ changeId: string | null }>(
        '/seal',
        body,
      );
      return changeId ?? undefined;
    });
  }

  async head(dir: string): Promise<string | undefined> {
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      let entries = await this.#post<HistoryEntry[]>('/list', { dir });
      return entries[0]?.changeId;
    });
  }

  async list(
    dir: string,
    options?: { limit?: number; flush?: boolean },
  ): Promise<HistoryEntry[]> {
    if (options?.flush !== false) {
      await this.flush(dir);
    }
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      let entries = await this.#post<HistoryEntry[]>('/list', { dir });
      if (
        options?.limit &&
        options.limit > 0 &&
        entries.length > options.limit
      ) {
        return entries.slice(0, options.limit);
      }
      return entries;
    });
  }

  async fileAt(
    dir: string,
    revisionId: string,
    path: string,
  ): Promise<Buffer | undefined> {
    if (!isValidRevisionId(revisionId) || !isValidHistoryPath(path)) {
      return undefined;
    }
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      let result = await this.#post<{ found: boolean; contentBase64?: string }>(
        '/file-at',
        { dir, revisionId, path },
      );
      if (!result.found || !result.contentBase64) {
        return undefined;
      }
      return Buffer.from(result.contentBase64, 'base64');
    });
  }

  async fileListAt(dir: string, revisionId: string): Promise<string[]> {
    if (!isValidRevisionId(revisionId)) {
      throw new Error('invalid revision id');
    }
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      let result = await this.#post<{ paths: string[] }>('/file-list-at', {
        dir,
        revisionId,
      });
      return result.paths;
    });
  }

  async restorePlan(dir: string, revisionId: string): Promise<RestorePlan> {
    if (!isValidRevisionId(revisionId)) {
      throw new Error('invalid revision id');
    }
    await this.flush(dir);
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      return this.#post<RestorePlan>('/restore-plan', { dir, revisionId });
    });
  }

  async probe(dir: string): Promise<boolean> {
    try {
      await this.#queue.run(dir, () => this.#ensure(dir));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.#debouncer.close();
  }

  async #ensure(dir: string): Promise<void> {
    if (this.#ensured.has(dir)) {
      return;
    }
    await this.#post('/ensure', { dir, watch: this.#watch });
    this.#ensured.add(dir);
  }

  async #post<T = unknown>(path: string, body: unknown): Promise<T> {
    let response = await fetch(`${this.#base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let text = await response.text();
    if (!response.ok) {
      throw new Error(`${this.kind} ${path} ${response.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
