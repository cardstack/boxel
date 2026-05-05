import {
  logger,
  type DBAdapter,
  type IndexingProgressEvent,
  type Stats,
} from '@cardstack/runtime-common';

let log = logger('indexing-event-sink');

export interface RealmIndexingState {
  realmURL: string;
  jobId: number;
  jobType: string;
  status: 'indexing' | 'finished';
  totalFiles: number;
  filesCompleted: number;
  /** All files that need to be indexed */
  files: string[];
  /** Files that have been indexed so far */
  completedFiles: string[];
  stats?: Stats;
  startedAt: number;
  lastUpdatedAt: number;
}

// Bound on how often `file-visited` events drive a write-through to
// the `job_progress` Postgres table — once per dirty job per tick.
// Tuned for "live enough for a 5s Grafana refresh" without amplifying
// per-file events into per-file UPDATEs. Override only in tests.
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

export class IndexingEventSink {
  /** Active indexing state keyed by jobId */
  #active = new Map<number, RealmIndexingState>();

  /** Recently completed indexing runs (most recent first) */
  #history: RealmIndexingState[] = [];

  /** Max history entries to keep */
  #maxHistory = 50;

  /** Tracks unique completed files per job to avoid duplicates */
  #completedFilesSets = new Map<number, Set<string>>();

  /** Max completed files to keep per job for UI/display purposes */
  #maxCompletedFilesPerJob = 1000;

  // Postgres write-through state. The adapter is optional so the
  // sink can run as in-memory only (existing unit tests, and any caller
  // that hasn't wired one up yet).
  #adapter: DBAdapter | undefined;
  #dirtyJobIds = new Set<number>();
  #flushTimer: NodeJS.Timeout | undefined;
  #flushInFlight = false;
  #disposed = false;
  #flushIntervalMs: number;
  #fileVisitedLogEvery: number;

  constructor(
    opts: { flushIntervalMs?: number; fileVisitedLogEvery?: number } = {},
  ) {
    this.#flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    // 1 = log every file-visited (most fidelity, highest log volume).
    // 10 ≈ ~1 line/sec/job at heavy indexing throughput.
    // Values <1 are treated as 1.
    this.#fileVisitedLogEvery = Math.max(1, opts.fileVisitedLogEvery ?? 1);
  }

  /**
   * Enable Postgres write-through to the `job_progress` table. Called
   * once from the realm-server boot path after the PgAdapter is ready.
   *
   * UPSERT-on-every-write means a missed `indexing-started` (e.g. boot
   * race) self-heals on the first periodic flush; the dashboard may
   * briefly show 0/0 progress before catching up.
   *
   * Independent setInterval timer per sink — `dispose()` clears it so
   * tests that create-and-tear-down sinks don't leak handles.
   */
  setAdapter(adapter: DBAdapter): void {
    if (this.#disposed) {
      return;
    }
    this.#adapter = adapter;
    if (!this.#flushTimer) {
      this.#flushTimer = setInterval(
        () => this.#flushDirty(),
        this.#flushIntervalMs,
      );
      this.#flushTimer.unref?.();
    }
  }

  /**
   * Stop the flush timer and disable further DB writes. Called from
   * the realm-server's shutdown path before the PgAdapter is closed,
   * so an in-flight flush can't race with adapter teardown.
   */
  dispose(): void {
    this.#disposed = true;
    if (this.#flushTimer) {
      clearInterval(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    this.#dirtyJobIds.clear();
  }

  handleEvent(event: IndexingProgressEvent): void {
    switch (event.type) {
      case 'indexing-started': {
        let totalFiles = event.totalFiles ?? 0;
        this.#active.set(event.jobId, {
          realmURL: event.realmURL,
          jobId: event.jobId,
          jobType: event.jobType ?? 'unknown',
          status: 'indexing',
          totalFiles,
          filesCompleted: 0,
          files: event.files ?? [],
          completedFiles: [],
          startedAt: Date.now(),
          lastUpdatedAt: Date.now(),
        });
        this.#completedFilesSets.set(event.jobId, new Set());
        log.info(
          `[indexing-progress] event=started job=${event.jobId} realm=${event.realmURL} total_files=${totalFiles}`,
        );
        // Detached: don't block the IPC handler waiting on Postgres.
        void this.#upsertProgress(event.jobId, 0, totalFiles);
        break;
      }
      case 'file-visited': {
        let state = this.#active.get(event.jobId);
        if (state) {
          state.filesCompleted =
            event.filesCompleted ?? state.filesCompleted + 1;
          state.totalFiles = event.totalFiles ?? state.totalFiles;
          if (event.url) {
            let completedSet = this.#completedFilesSets.get(event.jobId);
            if (!completedSet) {
              completedSet = new Set(state.completedFiles);
              this.#completedFilesSets.set(event.jobId, completedSet);
            }
            if (!completedSet.has(event.url)) {
              completedSet.add(event.url);
              state.completedFiles.push(event.url);
              if (state.completedFiles.length > this.#maxCompletedFilesPerJob) {
                const excess =
                  state.completedFiles.length - this.#maxCompletedFilesPerJob;
                const removed = state.completedFiles.splice(0, excess);
                for (let url of removed) {
                  completedSet.delete(url);
                }
              }
            }
          }
          state.lastUpdatedAt = Date.now();
          // Per-file log line is the highest-volume signal (~17/sec/job at
          // heavy indexing). Sample by `fileVisitedLogEvery` so operators
          // can dial back Loki ingest cost without losing started/finished.
          if (state.filesCompleted % this.#fileVisitedLogEvery === 0) {
            log.info(
              `[indexing-progress] event=file-visited job=${event.jobId} realm=${state.realmURL} seq=${state.filesCompleted} total=${state.totalFiles} file=${event.url ?? ''}`,
            );
          }
          // Coalesce file-visited events into one UPDATE per tick;
          // the periodic flush below picks up the dirty set.
          this.#dirtyJobIds.add(event.jobId);
        }
        break;
      }
      case 'indexing-finished': {
        let state = this.#active.get(event.jobId);
        let finalCompleted = state?.filesCompleted ?? 0;
        let finalTotal = state?.totalFiles ?? 0;
        if (state) {
          state.status = 'finished';
          state.stats = event.stats;
          state.lastUpdatedAt = Date.now();
          this.#history.unshift({ ...state });
          if (this.#history.length > this.#maxHistory) {
            this.#history.length = this.#maxHistory;
          }
        }
        this.#active.delete(event.jobId);
        this.#completedFilesSets.delete(event.jobId);
        // Don't leave a stale dirty entry pointing at a job that no
        // longer has in-memory state — the next flush would no-op,
        // but it's clearer to clean up here.
        this.#dirtyJobIds.delete(event.jobId);
        log.info(
          `[indexing-progress] event=finished job=${event.jobId} realm=${event.realmURL} files_completed=${finalCompleted}`,
        );
        // Final write — don't wait for the next tick, so the row
        // reflects terminal state by the time the dashboard refreshes.
        if (state) {
          void this.#upsertProgress(event.jobId, finalCompleted, finalTotal);
        }
        break;
      }
    }
  }

  getActiveIndexing(): RealmIndexingState[] {
    return [...this.#active.values()];
  }

  getHistory(): RealmIndexingState[] {
    return [...this.#history];
  }

  getSnapshot(): {
    active: RealmIndexingState[];
    history: RealmIndexingState[];
  } {
    return {
      active: this.getActiveIndexing(),
      history: this.getHistory(),
    };
  }

  async #flushDirty(): Promise<void> {
    // Skip if a prior flush is still in flight — under DB pressure a slow
    // UPSERT batch can outlast the timer interval, and overlapping flushes
    // would compound load instead of relieving it. The dirty set persists
    // across the skip so the next tick picks them up.
    if (
      this.#disposed ||
      !this.#adapter ||
      this.#flushInFlight ||
      this.#dirtyJobIds.size === 0
    ) {
      return;
    }
    this.#flushInFlight = true;
    try {
      let dirty = [...this.#dirtyJobIds];
      this.#dirtyJobIds.clear();
      await Promise.all(
        dirty.map((jobId) => {
          let state = this.#active.get(jobId);
          if (!state) {
            return Promise.resolve();
          }
          return this.#upsertProgress(
            jobId,
            state.filesCompleted,
            state.totalFiles,
          );
        }),
      );
    } finally {
      this.#flushInFlight = false;
    }
  }

  async #upsertProgress(
    jobId: number,
    filesCompleted: number,
    totalFiles: number,
  ): Promise<void> {
    if (this.#disposed || !this.#adapter) {
      return;
    }
    try {
      await this.#adapter.execute(
        `INSERT INTO job_progress (job_id, total_files, files_completed, last_progress_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (job_id) DO UPDATE SET
           total_files = EXCLUDED.total_files,
           files_completed = EXCLUDED.files_completed,
           last_progress_at = NOW()`,
        { bind: [jobId, totalFiles, filesCompleted] },
      );
    } catch (e) {
      log.error(
        `[indexing-progress] failed to upsert job_progress for job ${jobId}: ${(e as Error).message}`,
      );
    }
  }
}
