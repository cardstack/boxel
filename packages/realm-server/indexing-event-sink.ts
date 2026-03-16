import type { IndexingProgressEvent, Stats } from '@cardstack/runtime-common';

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

  handleEvent(event: IndexingProgressEvent): void {
    switch (event.type) {
      case 'indexing-started': {
        this.#active.set(event.jobId, {
          realmURL: event.realmURL,
          jobId: event.jobId,
          jobType: event.jobType ?? 'unknown',
          status: 'indexing',
          totalFiles: event.totalFiles ?? 0,
          filesCompleted: 0,
          files: event.files ?? [],
          completedFiles: [],
          startedAt: Date.now(),
          lastUpdatedAt: Date.now(),
        });
        this.#completedFilesSets.set(event.jobId, new Set());
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
        }
        break;
      }
      case 'indexing-finished': {
        let state = this.#active.get(event.jobId);
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
}
