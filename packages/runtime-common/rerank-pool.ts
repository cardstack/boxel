// A pool of threads that score `rerank` formulas, so a formula over a window
// of rows never runs on the realm server's event loop. Node only: the realm
// server registers it with `setRerankScorer(new RerankPool().scorer)`.
//
// Each thread scores one window at a time. A request waits for a free thread
// within its own deadline; past the deadline it resolves as timed out. A
// thread still busy at the deadline is terminated rather than left to finish,
// since the formula it is running may never return in time, and a fresh one
// starts on the next request.
import { Worker } from 'node:worker_threads';

import { RerankFormulaError } from './rerank-score.ts';
import type { RerankScorer, RerankScores } from './rerank-score.ts';
import type {
  RerankThreadRequest,
  RerankThreadResponse,
} from './rerank-thread.ts';

const DEFAULT_RERANK_THREADS = 2;
const RERANK_THREAD_IDLE_MS = 60_000;
const RERANK_THREAD_HEAP_LIMIT_MB = 256;

interface Job {
  id: number;
  expr: string;
  docs: Record<string, unknown>[];
  deadline: number;
  resolve: (scores: RerankScores) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface Thread {
  worker: Worker;
  job?: Job;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const TIMED_OUT: RerankScores = { values: [], timedOut: true };

export class RerankPool {
  readonly size: number;
  #threads: Thread[] = [];
  #queue: Job[] = [];
  #nextId = 1;

  constructor(
    size = Number(process.env.RERANK_THREADS) || DEFAULT_RERANK_THREADS,
  ) {
    this.size = Math.max(1, Math.floor(size));
  }

  // The scorer to register with `setRerankScorer`.
  scorer: RerankScorer = (expr, docs, deadline) =>
    new Promise<RerankScores>((resolve, reject) => {
      if (Date.now() >= deadline) {
        resolve(TIMED_OUT);
        return;
      }
      let job: Job = {
        id: this.#nextId++,
        expr,
        docs,
        deadline,
        resolve,
        reject,
      };
      job.timer = setTimeout(
        () => this.#timeOut(job),
        Math.max(0, deadline - Date.now()),
      );
      job.timer.unref?.();
      this.#queue.push(job);
      this.#dispatch();
    });

  // How many threads are running, for tests.
  get running(): number {
    return this.#threads.length;
  }

  async terminate(): Promise<void> {
    let threads = this.#threads;
    this.#threads = [];
    for (let job of this.#queue) {
      clearTimeout(job.timer);
      job.resolve(TIMED_OUT);
    }
    this.#queue = [];
    await Promise.all(
      threads.map((t) => {
        clearTimeout(t.idleTimer);
        if (t.job) {
          clearTimeout(t.job.timer);
          t.job.resolve(TIMED_OUT);
        }
        return t.worker.terminate();
      }),
    );
  }

  #dispatch() {
    while (this.#queue.length > 0) {
      let thread =
        this.#threads.find((t) => !t.job) ??
        (this.#threads.length < this.size ? this.#start() : undefined);
      if (!thread) return;
      let job = this.#queue.shift()!;
      clearTimeout(thread.idleTimer);
      thread.job = job;
      thread.worker.ref();
      thread.worker.postMessage({
        id: job.id,
        expr: job.expr,
        docs: job.docs,
        deadline: job.deadline,
      } satisfies RerankThreadRequest);
    }
  }

  #timeOut(job: Job) {
    let queued = this.#queue.indexOf(job);
    if (queued >= 0) {
      this.#queue.splice(queued, 1);
      job.resolve(TIMED_OUT);
      return;
    }
    let thread = this.#threads.find((t) => t.job === job);
    if (thread) {
      // Still scoring at its deadline: stop it, so a formula that will not
      // return in time holds no thread the next request needs.
      this.#remove(thread);
      void thread.worker.terminate();
      job.resolve(TIMED_OUT);
      this.#dispatch();
    }
  }

  #start(): Thread {
    let worker = new Worker(new URL('./rerank-thread.ts', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: RERANK_THREAD_HEAP_LIMIT_MB },
    });
    worker.unref();
    let thread: Thread = { worker };
    worker.on('message', (response: RerankThreadResponse) => {
      let job = thread.job;
      if (!job || job.id !== response.id) return;
      clearTimeout(job.timer);
      thread.job = undefined;
      worker.unref();
      if ('error' in response) {
        job.reject(
          response.compile
            ? new RerankFormulaError(response.error)
            : new Error(response.error),
        );
      } else {
        job.resolve(response.scores);
      }
      thread.idleTimer = setTimeout(() => {
        if (!thread.job && this.#threads.includes(thread)) {
          this.#remove(thread);
          void worker.terminate();
        }
      }, RERANK_THREAD_IDLE_MS);
      thread.idleTimer.unref?.();
      this.#dispatch();
    });
    let fail = (e: Error) => {
      if (!this.#threads.includes(thread)) return;
      this.#remove(thread);
      let job = thread.job;
      thread.job = undefined;
      if (job) {
        clearTimeout(job.timer);
        job.reject(e);
      }
      this.#dispatch();
    };
    worker.on('error', fail);
    worker.on('exit', (code) =>
      fail(new Error(`a rerank thread exited with code ${code}`)),
    );
    this.#threads.push(thread);
    return thread;
  }

  #remove(thread: Thread) {
    clearTimeout(thread.idleTimer);
    this.#threads = this.#threads.filter((t) => t !== thread);
  }
}
