import { registerDestructor } from '@ember/destroyable';
import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { createArming, type ChoreoContext } from 'glimmer-motion';

import { traceMotionPhase } from '@cardstack/host/lib/motion-trace';

export type HostChoreography = 'stack' | 'header' | 'sheet';

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
