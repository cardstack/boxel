import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';
import type SurfaceService from '@cardstack/host/services/surface-service';

interface Signature {
  Element: HTMLElement;
  Args: { Positional: [SandboxRenderSlot] };
}

/** Mount the persistent Sandbox iframe into its current Host render slot. */
export default class BoxelSandboxSlotModifier extends Modifier<Signature> {
  @service declare private boxelExecution: BoxelExecutionService;
  @service declare private surfaceService: SurfaceService;

  modify(element: HTMLElement, [slot]: [SandboxRenderSlot]) {
    element.replaceChildren(slot.iframe);
    let detach = this.surfaceService.attach(slot.surface, element);
    return () => {
      detach();
      // Do not destroy the process on a Glimmer rerender. The runtime owner
      // parks or destroys this iframe when the session lease is released.
      this.boxelExecution.parkSandboxIframe(slot.iframe);
    };
  }
}
