import { shape } from 'glimmer-motion/test-support';

/**
 * Watches the AI assistant transcript frame by frame while something plays
 * (a room replay), and says what a reader would have seen go wrong: a message
 * or tool row scaled, two messages painted over each other, a message on
 * screen jumping in one frame, or a move the scroll cancels out (its
 * translate changes every frame while the message stays put, so the reader
 * sees no glide). See motion/README.md for why each of these happened.
 */
export interface TranscriptMotionLimits {
  /**
   * The largest step a message on screen may take in one frame, as a share
   * of the view's height. A glide over the transcript's move clock stays
   * well under it; a step at least the view's height is a jump the region
   * makes on purpose (a change too far to animate lands as layout puts it).
   */
  maxStepOfView: number;
  /** px one message may paint over the next */
  maxOverlap: number;
  /** frames, in all, a message may hold still while its move plays */
  maxCancelledFrames: number;
  /** how far from 1 a scale may read before it counts as one */
  scaleTolerance: number;
}

export const DEFAULT_TRANSCRIPT_MOTION_LIMITS: TranscriptMotionLimits = {
  maxStepOfView: 0.3,
  maxOverlap: 1,
  maxCancelledFrames: 2,
  scaleTolerance: 0.01,
};

const MESSAGE = '[data-test-ai-assistant-message]';
const ROW = '[data-test-tool-call-id]';
const SCROLLER = '.pretui-stick-to-bottom-viewport';
// leavers a region keeps on screen for their exit: they may overlap
const MEMORY = '[data-motion-memory]';

interface MessageSample {
  /** the same element across frames */
  key: number;
  idx: string | null;
  top: number;
  bottom: number;
  /** the translate its region is writing, px */
  ty: number;
}

export interface ProbeFrame {
  f: number;
  /** ms since the probe started */
  t: number;
  /** what the replay sent just before this frame */
  marks: string[];
  scrollTop: number;
  scrollHeight: number;
  /** the scroll owner is following the end */
  following: boolean;
  viewTop: number;
  viewBottom: number;
  messages: MessageSample[];
  /** messages and rows whose painted shape is scaled */
  scaled: string[];
}

export interface ProbeIssue {
  kind: 'scaled' | 'overlap' | 'jump' | 'cancelled-glide';
  frame: number;
  detail: string;
}

export interface ProbeReport {
  frames: ProbeFrame[];
  issues: ProbeIssue[];
  /** the largest on-screen step that was not an intended jump, px */
  largestStep: number;
  /** a few lines per frame around the first issue of each kind */
  trace: string;
}

export class TranscriptMotionProbe {
  frames: ProbeFrame[] = [];
  private marks: string[] = [];
  private keys = new WeakMap<Element, number>();
  private nextKey = 0;
  private running = false;
  private start = 0;

  mark(label: string) {
    this.marks.push(label);
  }

  begin() {
    this.running = true;
    this.start = performance.now();
    // one sample per painted frame is the probe's whole job: it reads what
    // the frame showed, and changes no state a test waits on
    let sample = () => {
      if (!this.running) {
        return;
      }
      this.frames.push(this.sample());
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      requestAnimationFrame(sample);
    };
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
    requestAnimationFrame(sample);
  }

  end() {
    this.running = false;
  }

  private keyOf(el: Element) {
    let key = this.keys.get(el);
    if (key === undefined) {
      key = this.nextKey++;
      this.keys.set(el, key);
    }
    return key;
  }

  private sample(): ProbeFrame {
    let scroller = document.querySelector<HTMLElement>(SCROLLER);
    let view = scroller?.getBoundingClientRect();
    let viewTop = view?.top ?? 0;
    let viewBottom = view?.bottom ?? window.innerHeight;
    let onScreen = (r: DOMRect) =>
      r.height > 0 && r.bottom > viewTop && r.top < viewBottom;
    let scaled: string[] = [];
    let isScaled = (el: Element) => {
      let { a, b, c, d } = shape(el);
      let tolerance = DEFAULT_TRANSCRIPT_MOTION_LIMITS.scaleTolerance;
      return (
        Math.abs(a - 1) > tolerance ||
        Math.abs(d - 1) > tolerance ||
        Math.abs(b) > tolerance ||
        Math.abs(c) > tolerance
      );
    };
    let messages: MessageSample[] = [];
    for (let el of document.querySelectorAll<HTMLElement>(MESSAGE)) {
      if (el.closest(MEMORY)) {
        continue;
      }
      let r = el.getBoundingClientRect();
      if (r.height === 0) {
        continue;
      }
      let idx = el.getAttribute('data-test-message-idx');
      let m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      messages.push({
        key: this.keyOf(el),
        idx,
        top: r.top,
        bottom: r.bottom,
        ty: m.f,
      });
      if (onScreen(r) && isScaled(el)) {
        scaled.push(`message #${idx}`);
      }
    }
    for (let el of document.querySelectorAll<HTMLElement>(ROW)) {
      if (el.closest(MEMORY)) {
        continue;
      }
      if (onScreen(el.getBoundingClientRect()) && isScaled(el)) {
        scaled.push(`row ${el.getAttribute('data-test-tool-call-id')}`);
      }
    }
    let frame: ProbeFrame = {
      f: this.frames.length,
      t: Math.round(performance.now() - this.start),
      marks: this.marks,
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      following: scroller?.dataset.following === 'true',
      viewTop,
      viewBottom,
      messages,
      scaled,
    };
    this.marks = [];
    return frame;
  }

  /**
   * Every frame, one line each: what the replay sent, the scroll, and each
   * message on screen with its painted top and bottom and its translate.
   */
  fullTrace() {
    return this.frames.map(describe).join('\n');
  }

  report(limits: Partial<TranscriptMotionLimits> = {}): ProbeReport {
    let { maxStepOfView, maxOverlap, maxCancelledFrames } = {
      ...DEFAULT_TRANSCRIPT_MOTION_LIMITS,
      ...limits,
    };
    let issues: ProbeIssue[] = [];
    let cancelled: ProbeIssue[] = [];
    let largestStep = 0;
    let frames = this.frames;
    for (let [i, frame] of frames.entries()) {
      let { viewTop, viewBottom } = frame;
      let view = viewBottom - viewTop;
      let seen = (m: { top: number; bottom: number }) =>
        m.bottom > viewTop && m.top < viewBottom;
      for (let what of frame.scaled) {
        issues.push({ kind: 'scaled', frame: frame.f, detail: what });
      }
      for (let [k, m] of frame.messages.entries()) {
        let next = frame.messages[k + 1];
        if (
          next &&
          (seen(m) || seen(next)) &&
          m.bottom > next.top + maxOverlap
        ) {
          issues.push({
            kind: 'overlap',
            frame: frame.f,
            detail: `message #${m.idx} paints ${Math.round(m.bottom - next.top)}px over #${next.idx}`,
          });
        }
      }
      let prior = frames[i - 1];
      if (!prior) {
        continue;
      }
      let before = new Map(prior.messages.map((m) => [m.key, m]));
      for (let m of frame.messages) {
        let was = before.get(m.key);
        if (!was || !(seen(m) || seen(was))) {
          continue;
        }
        let step = Math.abs(m.top - was.top);
        if (step < view) {
          largestStep = Math.max(largestStep, step);
          if (step > view * maxStepOfView) {
            issues.push({
              kind: 'jump',
              frame: frame.f,
              detail: `message #${m.idx} moved ${Math.round(step)}px in one frame (view ${Math.round(view)}px)`,
            });
          }
        }
        // A move that starts holds the message where it was painted: its
        // translate jumps while it stays put, by design. A move that plays
        // brings the translate back toward rest; if the message stays put
        // while that happens, the scroll took the glide away.
        if (Math.abs(m.ty) < Math.abs(was.ty) - 2 && step < 0.5) {
          cancelled.push({
            kind: 'cancelled-glide',
            frame: frame.f,
            detail: `message #${m.idx}'s translate went ${Math.round(was.ty)} → ${Math.round(m.ty)}px while it stayed put (the scroll moved by the same amount)`,
          });
        }
      }
    }
    if (cancelled.length > maxCancelledFrames) {
      issues.push(...cancelled);
    }
    return {
      frames,
      issues,
      largestStep: Math.round(largestStep),
      trace: traceAround(frames, issues),
    };
  }
}

function describe(frame: ProbeFrame) {
  return (
    `f${frame.f} +${frame.t}ms${frame.marks.length ? ` [${frame.marks.join(' ')}]` : ''} scroll ${Math.round(frame.scrollTop)}/${frame.scrollHeight}${frame.following ? ' following' : ''} | ` +
    frame.messages
      .filter((m) => m.bottom > frame.viewTop && m.top < frame.viewBottom)
      .map(
        (m) =>
          `#${m.idx} ${Math.round(m.top)}–${Math.round(m.bottom)}${m.ty ? ` ty${Math.round(m.ty)}` : ''}`,
      )
      .join(' · ')
  );
}

function traceAround(frames: ProbeFrame[], issues: ProbeIssue[]) {
  let around = new Set<number>();
  let firsts = new Map<string, number>();
  for (let issue of issues) {
    if (!firsts.has(issue.kind)) {
      firsts.set(issue.kind, issue.frame);
    }
  }
  for (let f of firsts.values()) {
    for (let k = f - 3; k <= f + 3; k++) {
      around.add(k);
    }
  }
  return frames
    .filter((frame) => around.has(frame.f))
    .map(describe)
    .join('\n');
}
