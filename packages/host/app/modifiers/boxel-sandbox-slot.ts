import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import Modifier, { type ArgsFor } from 'ember-modifier';

import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import type SurfaceService from '@cardstack/host/services/surface-service';

interface Signature {
  Element: HTMLElement;
  Args: { Positional: [SandboxRenderSlot] };
}

/**
 * Mounts the Sandbox process's iframe into its Host render slot.
 *
 * RP-15.3: a live iframe is never re-parented — a cross-origin iframe's
 * document reloads on any move, so there is no such thing as "parking" one
 * to preserve it. `slot.process.mount(element)` is the ONLY place the
 * process's iframe is ever inserted into the document, and it inserts
 * directly into this PERMANENT slot element. A modifier replacement on the
 * same element transfers ownership without moving the iframe; the stale
 * modifier's teardown token then cannot close the replacement's client. On
 * current-owner teardown, `unmount()` kills that iframe for good; there is
 * nothing to park it into. The process itself (and its already-accumulated
 * classification/module-authority state) is retained by the runtime
 * router's own surface-identity cache — a later remount on the SAME
 * process mints a fresh iframe rather than re-observing the module graph.
 */
export default class BoxelSandboxSlotModifier extends Modifier<Signature> {
  @service declare private surfaceService: SurfaceService;

  private current?: {
    element: HTMLElement;
    slot: SandboxRenderSlot;
    detach: () => void;
    unmount: () => void;
  };

  constructor(owner: Owner, args: ArgsFor<Signature>) {
    super(owner, args);
    registerDestructor(this, () => this.releaseCurrent());
  }

  modify(element: HTMLElement, [slot]: [SandboxRenderSlot]) {
    if (
      this.current?.element === element &&
      this.current.slot.process === slot.process &&
      this.current.slot.mountToken === slot.mountToken &&
      this.current.slot.surface === slot.surface
    ) {
      return;
    }

    // Modifier arguments are updated in place. A cleanup function returned
    // from modify() is run BEFORE the next modify() call, which is too early
    // for a live cross-origin iframe: unmounting destroys its child document
    // and every child-local instance handle. Install the successor ownership
    // first, then release the predecessor. SandboxRuntimeProcess.mount()
    // transfers ownership on the same element, so the predecessor's tokened
    // unmount becomes a no-op and the iframe never leaves the DOM during an
    // isolated/edit format switch.
    let next = {
      element,
      slot,
      unmount: slot.process.mount(element, slot.mountToken),
      detach: this.surfaceService.attach(slot.surface, element),
    };
    let previous = this.current;
    this.current = next;
    previous?.detach();
    previous?.unmount();
  }

  private releaseCurrent(): void {
    let current = this.current;
    this.current = undefined;
    current?.detach();
    current?.unmount();
  }
}
