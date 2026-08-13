import { service } from '@ember/service';

import Modifier from 'ember-modifier';

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

  modify(element: HTMLElement, [slot]: [SandboxRenderSlot]) {
    let unmount = slot.process.mount(element, slot.mountToken);
    let detach = this.surfaceService.attach(slot.surface, element);
    return () => {
      detach();
      unmount();
    };
  }
}
