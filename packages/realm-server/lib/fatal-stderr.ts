import { isHeapExhaustion } from './finalize-orphan-reservations.ts';

// A child's stderr as whole lines. A pipe hands the parent whatever bytes it
// has, so V8's one-line fatal diagnostic can arrive split across two `data`
// events (`FATAL ERROR: …` in one, `… JavaScript heap out of memory` in the
// next). Classifying chunks would take the first half for some other fatal
// error. Classifying lines sees the diagnostic once, whole.
export class StderrLines {
  #partial = '';

  // The lines `chunk` completes, in order; an unterminated tail is held for
  // the next chunk.
  push(chunk: string): string[] {
    let lines = `${this.#partial}${chunk}`.split('\n');
    this.#partial = lines.pop() ?? '';
    return lines;
  }

  // The unterminated tail, once the stream has ended.
  flush(): string[] {
    let rest = this.#partial;
    this.#partial = '';
    return rest ? [rest] : [];
  }
}

export type FatalStderrKind = 'heap-exhausted' | 'fatal';

// What a whole stderr line says about the child: its V8 heap ran out, some
// other fatal error, or nothing the worker manager acts on.
export function classifyStderrLine(line: string): FatalStderrKind | undefined {
  if (!line.includes('FATAL ERROR')) {
    return undefined;
  }
  return isHeapExhaustion(line) ? 'heap-exhausted' : 'fatal';
}
