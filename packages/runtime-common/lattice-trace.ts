// Diagnostic only: no sink in browser or normal server operation. Never use
// fingerprints or timing evidence to authorize, cache, or schedule work.
export interface LatticeTraceSink {
  identity: string;
  write(event: Record<string, unknown>): void;
  hash(text: string): string;
}
let sink: LatticeTraceSink | undefined;
export function configureLatticeTrace(next?: LatticeTraceSink) {
  sink = next;
}
export function latticeAttemptId(url: string, generation: number) {
  return `${url}@${generation}`;
}
export function startLatticeTrace(
  id: string,
  kind: string,
  metadata: Record<string, unknown> = {},
): LatticeTrace | undefined {
  return sink ? new LatticeTrace(sink, id, kind, metadata) : undefined;
}
export class LatticeTrace {
  private started = performance.now();
  private phaseStart = this.started;
  private phase?: string;
  private finished = false;
  private sequence = 0;
  private overheadMs = 0;
  private sink: LatticeTraceSink;
  readonly id: string;
  readonly kind: string;
  constructor(
    sink: LatticeTraceSink,
    id: string,
    kind: string,
    metadata: Record<string, unknown>,
  ) {
    this.sink = sink;
    this.id = id;
    this.kind = kind;
    this.event('start', metadata);
  }
  hash(text: string): string | undefined {
    const start = performance.now();
    try {
      return this.sink.hash(text);
    } catch {
      return undefined;
    } finally {
      this.overheadMs += performance.now() - start;
    }
  }
  event(event: string, data: Record<string, unknown> = {}) {
    // Logging must not change computation outcomes, including a broken sink.
    const start = performance.now();
    try {
      this.sink.write({
        ...data,
        schema: 1,
        identity: this.sink.identity,
        id: this.id,
        kind: this.kind,
        event,
        sequence: this.sequence++,
        at: Date.now(),
        mono: performance.now(),
      });
    } catch {
      /* diagnostic failure is never a card failure */
    } finally {
      this.overheadMs += performance.now() - start;
    }
  }
  entries(event: string, items: unknown[]) {
    for (let offset = 0; offset < items.length; offset += 64)
      this.event(event, {
        offset,
        total: items.length,
        items: items.slice(offset, offset + 64),
      });
  }
  stage(name: string) {
    if (this.finished) return;
    const now = performance.now();
    if (this.phase)
      this.event('span', {
        phase: this.phase,
        start: this.phaseStart,
        end: now,
        ms: now - this.phaseStart,
        scope: 'sequential',
      });
    this.phase = name;
    this.phaseStart = now;
  }
  async measure<T>(phase: string, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    let status = 'fulfilled';
    try {
      return await work();
    } catch (error) {
      status = 'rejected';
      throw error;
    } finally {
      const end = performance.now();
      this.event('span', {
        phase,
        start,
        end,
        ms: end - start,
        status,
        scope: 'nested',
      });
    }
  }
  finish(outcome: string, data: Record<string, unknown> = {}) {
    if (this.finished) return;
    this.stage('finished');
    this.finished = true;
    this.event('finish', {
      ...data,
      outcome,
      elapsedMs: performance.now() - this.started,
      overheadMs: this.overheadMs,
    });
  }
}
