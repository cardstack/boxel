// Pretui — TerminalAnimation: a replayed command-line session with no JavaScript timing.
import Component from '@glimmer/component';
import { cssStyleFrom } from '../pretui-css';

// ── TerminalAnimation ────────────────────────────────────────────────────
// A command-line session, replayed. The genre's whole appeal is the sense of
// something happening in order, and the genre's whole implementation problem
// is that everyone reaches for a timer to get it.
//
// There is no timer here, and there is no JavaScript timing of any kind. The
// schedule is computed once, as arithmetic, into two custom properties per
// line: when it appears, and (for a command) how long its characters take.
// The appearance is one keyframe with `animation-delay`; the typing is a
// `width` sweep with a `steps(n)` timing function set inline from the line's
// own character count, so each glyph lands on a character boundary.
//
// Consequences worth stating:
//   · Replay is identity, not a clock. Change `@replayToken` and the rows
//     are re-created, so their animations start over. That is the whole
//     mechanism.
//   · `prefers-reduced-motion: reduce` lands on the FINISHED transcript —
//     every line present at full width — never on a frozen midpoint.
//   · The animated transcript is `aria-hidden` and mirrored by a complete
//     visually-hidden copy, the same contract `StreamingText` uses: a
//     screen reader gets the whole session at once instead of a text that
//     appears to be still arriving.

export type TerminalLineKind = 'command' | 'output' | 'error' | 'comment';

export interface TerminalLine {
  /** stable id */
  id: string;
  /** what kind of line this is (default 'output') */
  kind?: TerminalLineKind;
  /** the line's text */
  text: string;
  /** prompt shown before a command (default '$') */
  prompt?: string;
}

interface TerminalRow {
  key: string;
  id: string;
  kind: TerminalLineKind;
  text: string;
  prompt: string;
  isCommand: boolean;
  showCaret: boolean;
  lineStyle: ReturnType<typeof cssStyleFrom>;
  typeStyle: ReturnType<typeof cssStyleFrom>;
}

export interface TerminalAnimationSignature {
  Args: {
    /** the session, in the order it ran */
    lines: TerminalLine[];
    /** window title (default 'Terminal') */
    title?: string;
    /** seconds before the first line appears (default 0.2) */
    startDelay?: number;
    /** characters per second while a command types (default 26) */
    charRate?: number;
    /**
     * seconds a non-command line holds the stage before the next one starts
     * (default 0.45). Separate from `charRate` on purpose — typing and
     * reading are different rates because they read differently (Law 7).
     */
    lineDelay?: number;
    /** type commands out character by character (default true) */
    typing?: boolean;
    /** show the blinking caret after the last line (default true) */
    caret?: boolean;
    /**
     * change this to replay. Every row's key includes it, so a new value
     * re-creates the rows and their CSS animations start from zero — no
     * timer, no imperative restart.
     */
    replayToken?: string;
    /** accessible name for the transcript (default 'Terminal session') */
    label?: string;
  };
  Element: HTMLDivElement;
}

export class TerminalAnimation extends Component<TerminalAnimationSignature> {
  get title(): string {
    return this.args.title ?? 'Terminal';
  }
  get label(): string {
    return this.args.label ?? 'Terminal session';
  }
  get caret(): boolean {
    return this.args.caret ?? true;
  }
  private get typing(): boolean {
    return this.args.typing ?? true;
  }
  private get charRate(): number {
    let rate = Number(this.args.charRate ?? 26);
    return Number.isFinite(rate) && rate > 0 ? rate : 26;
  }
  private get lineDelay(): number {
    let delay = Number(this.args.lineDelay ?? 0.45);
    return Number.isFinite(delay) && delay >= 0 ? delay : 0.45;
  }
  private get startDelay(): number {
    let delay = Number(this.args.startDelay ?? 0.2);
    return Number.isFinite(delay) && delay >= 0 ? delay : 0.2;
  }

  /**
   * The schedule, computed once. Every value written into a style here is a
   * number this component formatted — never a caller string — so it needs no
   * `cssValue` round trip; the only caller strings in the component are text
   * nodes.
   */
  get rows(): TerminalRow[] {
    let lines = this.args.lines ?? [];
    let token = this.args.replayToken ?? '0';
    let at = this.startDelay;
    let rows: TerminalRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!;
      let kind: TerminalLineKind = line.kind ?? 'output';
      let isCommand = kind === 'command';
      let chars = line.text.length;
      let typeDuration =
        isCommand && this.typing && chars > 0 ? chars / this.charRate : 0;
      rows.push({
        key: token + ':' + line.id,
        id: line.id,
        kind,
        text: line.text,
        prompt: line.prompt ?? '$',
        isCommand,
        showCaret: this.caret && i === lines.length - 1,
        lineStyle: cssStyleFrom(['--pretui-term-at: ' + at.toFixed(3) + 's']),
        typeStyle:
          typeDuration > 0
            ? cssStyleFrom([
                '--pretui-term-at: ' + at.toFixed(3) + 's',
                '--pretui-term-dur: ' + typeDuration.toFixed(3) + 's',
                '--pretui-term-ch: ' + chars + 'ch',
                'animation-timing-function: steps(' + chars + ', end)',
              ])
            : undefined,
      });
      at += typeDuration + this.lineDelay;
    }
    return rows;
  }

  /** the whole session as one string, for the screen-reader mirror */
  get transcript(): string {
    return (this.args.lines ?? [])
      .map((line) =>
        line.kind === 'command'
          ? (line.prompt ?? '$') + ' ' + line.text
          : line.text,
      )
      .join('\n');
  }

  <template>
    <div class='pretui-term' data-test-pretui-terminal-animation ...attributes>
      <div class='pretui-term-bar'>
        <span class='pretui-term-dots' aria-hidden='true'>
          <i></i><i></i><i></i>
        </span>
        <span class='pretui-term-title'>{{this.title}}</span>
      </div>
      <figure class='pretui-term-screen'>
        <figcaption class='pretui-sr'>{{this.label}}</figcaption>
        {{! Each line is its own block with `white-space: pre`, so authoring
            whitespace BETWEEN lines cannot leak into the transcript — the
            reason this is a stack of blocks rather than one <pre>. }}
        <div class='pretui-term-visual' aria-hidden='true'>
          {{#each this.rows key='key' as |row|}}
            <span
              class='pretui-term-line'
              data-kind={{row.kind}}
              style={{row.lineStyle}}
            >{{#if row.isCommand}}<span
                  class='pretui-term-prompt'
                >{{row.prompt}}</span>{{/if}}{{#if row.typeStyle}}<span
                  class='pretui-term-type'
                  style={{row.typeStyle}}
                >{{row.text}}</span>{{else}}<span
                  class='pretui-term-text'
                >{{row.text}}</span>{{/if}}{{#if row.showCaret}}<span
                  class='pretui-term-caret'
                ></span>{{/if}}</span>
          {{/each}}
        </div>
        <span class='pretui-sr'>{{this.transcript}}</span>
      </figure>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-term {
          border-radius: var(--radius-surface, 12px);
          overflow: hidden;
          background: var(--pretui-term-bg, var(--boxel-700));
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.2)
          );
        }
        .pretui-term-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 30px;
          padding: 0 10px;
          background: color-mix(
            in oklch,
            var(--pretui-term-bg, var(--boxel-700)) 85%,
            #ffffff
          );
        }
        .pretui-term-dots {
          display: inline-flex;
          gap: 5px;
        }
        .pretui-term-dots i {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: color-mix(
            in oklch,
            var(--pretui-term-bg, var(--boxel-700)) 55%,
            #ffffff
          );
        }
        .pretui-term-title {
          font-family: var(--font-mono);
          font-size: 11px;
          color: color-mix(
            in oklch,
            var(--pretui-term-bg, var(--boxel-700)) 30%,
            #ffffff
          );
        }
        .pretui-term-screen {
          position: relative;
          margin: 0;
          padding: 12px 14px;
          min-height: var(--pretui-term-min, 8rem);
        }
        .pretui-term-visual {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--pretui-term-size, 12px);
          line-height: 1.65;
          overflow-x: auto;
          color: color-mix(in oklch, var(--pretui-term-bg, var(--boxel-700)) 18%, var(--boxel-light));
        }
        .pretui-term-line {
          display: block;
          white-space: pre;
          opacity: 0;
          animation: pretui-term-show 140ms linear var(--pretui-term-at, 0s) both;
        }
        @keyframes pretui-term-show {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        .pretui-term-line[data-kind='error'] {
          color: color-mix(in oklch, var(--destructive) 70%, var(--boxel-light));
        }
        .pretui-term-line[data-kind='comment'] {
          color: color-mix(in oklch, var(--pretui-term-bg, var(--boxel-700)) 48%, var(--boxel-light));
        }
        .pretui-term-line[data-kind='command'] {
          color: var(--boxel-light);
        }
        .pretui-term-prompt {
          display: inline-block;
          margin-right: 0.6ch;
          color: color-mix(in oklch, var(--primary) 45%, var(--boxel-light));
        }
        /* the typewriter: a width sweep whose step count is this line's own
           character count, set inline as an authored declaration */
        .pretui-term-type {
          display: inline-block;
          overflow: hidden;
          white-space: pre;
          vertical-align: bottom;
          width: 0;
          animation-name: pretui-term-type;
          animation-duration: var(--pretui-term-dur, 0.6s);
          animation-delay: var(--pretui-term-at, 0s);
          animation-fill-mode: both;
        }
        @keyframes pretui-term-type {
          from {
            width: 0;
          }
          to {
            width: var(--pretui-term-ch, 100%);
          }
        }
        .pretui-term-caret {
          display: inline-block;
          width: 0.6ch;
          height: 1em;
          margin-left: 0.2ch;
          vertical-align: text-bottom;
          background: currentColor;
          animation: pretui-term-blink 1.1s steps(1, end) infinite;
        }
        @keyframes pretui-term-blink {
          0%,
          50% {
            opacity: 1;
          }
          50.01%,
          100% {
            opacity: 0;
          }
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: pre;
          margin: 0;
        }
        /* the end state, not a frozen midpoint: the whole session, at rest */
        @media (prefers-reduced-motion: reduce) {
          .pretui-term-line {
            animation: none;
            opacity: 1;
          }
          .pretui-term-type {
            animation: none;
            width: auto;
          }
          .pretui-term-caret {
            animation: none;
            opacity: 1;
          }
        }
      }
    </style>
  </template>
}
