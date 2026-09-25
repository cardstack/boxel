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

  bind(kind: 'stack' | 'sheet', context: ChoreoContext) {
    this.contexts.set(kind, context);
    return () => {
      if (this.contexts.get(kind) === context) this.contexts.delete(kind);
    };
  }

  isArmed(kind: 'stack' | 'sheet') {
    return (
      !this.dragging &&
      !this.bitmapActive &&
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
    if (this.dragging || this.bitmapActive || this.workspaceActive) {
      traceMotionPhase(`begin-refused:${kind}`);
      return;
    }
    let context = this.contexts.get(kind === 'header' ? 'stack' : kind);
    if (!context) {
      traceMotionPhase(`begin-unbound:${kind}`);
      return;
    }
    traceMotionPhase(`begin:${kind}`);
    // Replacing the score within one region lets Choreo retain velocity.
    // A different scene yields its allocation before this one starts.
    if (this.choreography && this.choreography !== kind) this.finish();
    this.choreography = kind;
    this.primaryId = primaryId;
    this.arming.begin(context);
  }

  beginWorkspace() {
    this.finish();
    this.workspaceActive = true;
  }

  endWorkspace() {
    this.workspaceActive = false;
  }

  beginBitmap() {
    this.finish();
    let token = ++this.nextToken;
    if (!this.dragging) this.bitmapToken = token;
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
    for (let context of this.contexts.values()) {
      let run = context.run;
      if (run && !run.isDone()) run.time = run.duration;
    }
    this.arming.end();
  }
}
