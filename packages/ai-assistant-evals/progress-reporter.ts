import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
} from '@playwright/test/reporter';

// Prints, every EVAL_PROGRESS_SECONDS (default 15), one block that says where
// each model's run is: not started, the current step, the bot's state and
// message count, or the grade once done. It reads the `[eval-step]` lines the
// spec prints, so it works the same for worker runs and tabs runs.

const INTERVAL_MS = Number(process.env.EVAL_PROGRESS_SECONDS ?? 15) * 1000;
// A model with no new event for this long is flagged, so a stall shows before
// the spec's own two- and three-minute limits end the run.
const QUIET_FLAG_MS = 120_000;
const EVENT = /^\[eval-step\] (.+)$/;

interface ModelState {
  state: string;
  botMessages?: number;
  grade?: string;
  verdict?: string;
  startedAt?: number;
  lastEventAt?: number;
}

function expectedModels(): string[] {
  return (process.env.EVAL_MODELS ?? 'Claude Sonnet 4.6')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function seconds(ms: number): string {
  let s = Math.round(ms / 1000);
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export default class ProgressReporter implements Reporter {
  private models = new Map<string, ModelState>();
  private startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;

  onBegin(_config: FullConfig, _suite: Suite) {
    this.startedAt = Date.now();
    for (let model of expectedModels()) {
      this.models.set(model, { state: 'not started' });
    }
    this.timer = setInterval(() => this.print(), INTERVAL_MS);
  }

  onStdOut(chunk: string | Buffer, _test?: TestCase) {
    for (let line of chunk.toString().split('\n')) {
      let match = EVENT.exec(line.trim());
      if (!match) {
        continue;
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(match[1]);
      } catch {
        continue;
      }
      let model = String(event.model ?? '');
      if (!model) {
        continue;
      }
      let now = Date.now();
      let current = this.models.get(model) ?? { state: 'not started' };
      this.models.set(model, {
        ...current,
        state: String(event.state ?? current.state),
        botMessages:
          typeof event.botMessages === 'number'
            ? event.botMessages
            : current.botMessages,
        grade: typeof event.grade === 'string' ? event.grade : current.grade,
        verdict:
          typeof event.verdict === 'string' ? event.verdict : current.verdict,
        startedAt: current.startedAt ?? now,
        lastEventAt: now,
      });
    }
  }

  onEnd(_result: FullResult) {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.print();
  }

  printsToStdio() {
    // The list reporter owns the console; this only adds its block.
    return false;
  }

  private print() {
    let now = Date.now();
    let states = [...this.models.values()];
    let done = states.filter((m) => m.state === 'done').length;
    let waiting = states.filter((m) => m.state === 'not started').length;
    let running = states.length - done - waiting;
    let width = Math.max(...[...this.models.keys()].map((name) => name.length));
    let lines = [
      `[progress ${seconds(now - this.startedAt)}] ${running} running · ${done} done · ${waiting} not started`,
    ];
    for (let [name, m] of this.models) {
      let detail: string;
      if (m.state === 'done') {
        detail = `${m.grade ?? ''} ${m.verdict ?? ''} (${seconds((m.lastEventAt ?? now) - (m.startedAt ?? now))})`;
      } else if (m.state === 'not started') {
        detail = 'not started';
      } else {
        let quiet = now - (m.lastEventAt ?? now);
        detail = [
          m.state,
          m.botMessages !== undefined ? `${m.botMessages} bot messages` : '',
          `${seconds(now - (m.startedAt ?? now))} in`,
          quiet >= QUIET_FLAG_MS ? `⚠ no change for ${seconds(quiet)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
      }
      lines.push(`  ${name.padEnd(width)}  ${detail}`);
    }
    process.stdout.write(lines.join('\n') + '\n');
  }
}
