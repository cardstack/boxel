import { registerDestructor } from '@ember/destroyable';
import { schedule } from '@ember/runloop';
import Service from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { createArming, type ChoreoContext } from 'glimmer-motion';

import {
  crossfadeCardBitmap,
  supportsBitmapCrossing,
  type BitmapCrossing,
} from '@cardstack/host/lib/bitmap-crossing';
import { traceMotionPhase } from '@cardstack/host/lib/motion-trace';

export type HostChoreography = 'stack' | 'header' | 'sheet';

const crossingWaiter = buildWaiter('host-motion:crossing');

export interface HostCrossing extends Omit<
  BitmapCrossing,
  'onReady' | 'duration'
> {
  // Seconds. Crossings take no time in tests.
  duration: number;
  // Leave the existing stacks live under the crossing so they reflow with
  // Choreo (a card flying into a new stack). Otherwise the crossing owns the
  // whole scene and stack motion stands down until it lands.
  reflowStacks?: boolean;
}

// Policy belongs to the host; Choreo owns clocks, interruption and endpoints.
// One scene action may spend the geometry budget. Nothing is armed at rest.
export default class HostMotionService extends Service {
  @tracked private choreography?: HostChoreography;
  @tracked primaryId?: string;
  @tracked dragging = false;
  @tracked workspaceActive = false;
  @tracked private bitmapToken?: number;
  // A crossing that opens a new stack leaves the existing stacks live under
  // the view transition; they reflow with Choreo while the card flies.
  @tracked private bitmapReflow = false;
  private nextToken = 0;
  private contexts = new Map<'stack' | 'sheet', ChoreoContext>();
  private bitmapFinish?: () => void;
  private arming = createArming({
    onStandDown: () => {
      this.choreography = undefined;
      this.primaryId = undefined;
    },
  });

  constructor(...args: ConstructorParameters<typeof Service>) {
    super(...args);
    registerDestructor(this, () => this.finish());
  }

  get bitmapActive() {
    return this.bitmapToken !== undefined;
  }

  // Whether the running crossing leaves the stacks free to reflow.
  get stacksReflowing() {
    return this.bitmapActive && this.bitmapReflow;
  }

  bind(kind: 'stack' | 'sheet', context: ChoreoContext) {
    this.contexts.set(kind, context);
    return () => {
      if (this.contexts.get(kind) === context) this.contexts.delete(kind);
    };
  }

  isArmed(kind: 'stack' | 'sheet') {
    return (
      !this.dragging &&
      (!this.bitmapActive || (kind === 'stack' && this.bitmapReflow)) &&
      !this.workspaceActive &&
      this.arming.active() &&
      (this.choreography === kind ||
        (kind === 'stack' && this.choreography === 'header'))
    );
  }

  get headerActive() {
    return this.choreography === 'header';
  }

  begin(kind: HostChoreography, primaryId?: string) {
    let reflowing = this.bitmapActive && this.bitmapReflow && kind === 'stack';
    if (
      this.dragging ||
      (this.bitmapActive && !reflowing) ||
      this.workspaceActive
    ) {
      traceMotionPhase(`begin-refused:${kind}`);
      return;
    }
    let context = this.contexts.get(kind === 'header' ? 'stack' : kind);
    if (!context) {
      traceMotionPhase(`begin-unbound:${kind}`);
      return;
    }
    traceMotionPhase(`begin:${kind}${reflowing ? ':reflow' : ''}`);
    // Replacing the score within one region lets Choreo retain velocity.
    // A different scene yields its allocation before this one starts, but
    // never the crossing this reflow accompanies.
    if (this.choreography && this.choreography !== kind && !reflowing)
      this.finish();
    this.choreography = kind;
    // The crossing owns the new card; every existing stack moves.
    this.primaryId = reflowing ? undefined : primaryId;
    this.arming.begin(context);
  }

  beginWorkspace() {
    this.finish();
    this.workspaceActive = true;
  }

  endWorkspace() {
    this.workspaceActive = false;
  }

  // Whether a crossing would play. Callers with a different fallback (a
  // Choreo dock instead of a bitmap) check this before building one.
  canCross(from: HTMLElement | undefined, duration: number) {
    return (
      !isTesting() &&
      duration > 0 &&
      !this.dragging &&
      supportsBitmapCrossing() &&
      !!from?.isConnected
    );
  }

  // The one entry for a card-level bitmap crossing (open, return, expand,
  // search pick, workspace tile). Runs `update` directly when motion is off.
  async cross({
    update,
    duration,
    reflowStacks,
    ...crossing
  }: HostCrossing): Promise<void> {
    if (!this.canCross(crossing.from, duration)) {
      await update();
      return;
    }
    let budget = this.beginBitmap({ reflowStacks });
    let waiterToken = crossingWaiter.beginAsync();
    try {
      await crossfadeCardBitmap({
        ...crossing,
        duration,
        update: async () => {
          await update();
          // Look up and capture the landing's settled layout, not a
          // mid-render pose.
          await new Promise<void>((resolve) =>
            schedule('afterRender', resolve),
          );
        },
        onReady: (finish) => this.onBitmapReady(budget, finish),
      });
    } finally {
      this.endBitmap(budget);
      crossingWaiter.endAsync(waiterToken);
    }
  }

  beginBitmap({ reflowStacks = false } = {}) {
    this.finish();
    let token = ++this.nextToken;
    if (!this.dragging) {
      this.bitmapToken = token;
      this.bitmapReflow = reflowStacks;
    }
    return token;
  }

  onBitmapReady(token: number, finish: () => void) {
    if (this.bitmapToken === token && !this.dragging)
      this.bitmapFinish = finish;
    else finish();
  }

  endBitmap(token: number) {
    if (this.bitmapToken !== token) return;
    this.bitmapToken = undefined;
    this.bitmapReflow = false;
    this.bitmapFinish = undefined;
  }

  beginDrag() {
    this.dragging = true;
    this.finish();
  }

  endDrag() {
    // Ordinary clicks also release the pointer. Do not invalidate the entire
    // choreography tree when no drag occurred.
    if (this.dragging) this.dragging = false;
  }

  private finish() {
    this.workspaceActive = false;
    this.bitmapFinish?.();
    this.bitmapFinish = undefined;
    this.bitmapToken = undefined;
    this.bitmapReflow = false;
    for (let context of this.contexts.values()) {
      let run = context.run;
      if (run && !run.isDone()) run.time = run.duration;
    }
    this.arming.end();
  }
}
