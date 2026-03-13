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
  /** Active indexing state per realm */
  #active = new Map<string, RealmIndexingState>();

  /** Recently completed indexing runs (most recent first) */
  #history: RealmIndexingState[] = [];

  /** Max history entries to keep */
  #maxHistory = 50;

  handleEvent(event: IndexingProgressEvent): void {
    switch (event.type) {
      case 'indexing-started': {
        this.#active.set(event.realmURL, {
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
        break;
      }
      case 'file-visited': {
        let state = this.#active.get(event.realmURL);
        if (state) {
          state.filesCompleted = event.filesCompleted ?? state.filesCompleted + 1;
          state.totalFiles = event.totalFiles ?? state.totalFiles;
          if (event.url) {
            state.completedFiles.push(event.url);
          }
          state.lastUpdatedAt = Date.now();
        }
        break;
      }
      case 'indexing-finished': {
        let state = this.#active.get(event.realmURL);
        if (state) {
          state.status = 'finished';
          state.stats = event.stats;
          state.lastUpdatedAt = Date.now();
          this.#history.unshift({ ...state });
          if (this.#history.length > this.#maxHistory) {
            this.#history.length = this.#maxHistory;
          }
        }
        this.#active.delete(event.realmURL);
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
