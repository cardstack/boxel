import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import {
  surfaceLayoutEvent,
  surfaceObserveEvent,
  surfacePresentationEvent,
  type SurfaceLayoutIntent,
  type SurfaceObserveIntent,
  type SurfacePresentationIntent,
} from '@cardstack/boxel-ui/surface';

import type { SurfaceHandle } from '@cardstack/runtime-common';

import type SurfaceService from '@cardstack/host/services/surface-service';

interface Signature {
  Element: HTMLElement;
  Args: { Positional: [SurfaceHandle] };
}

export default class SurfaceElementModifier extends Modifier<Signature> {
  @service declare private surfaceService: SurfaceService;

  modify(element: HTMLElement, [handle]: [SurfaceHandle]) {
    let detach = this.surfaceService.attach(handle, element);
    let present = (event: Event) => {
      event.stopPropagation();
      if (!this.surfaceService.has(handle)) {
        return;
      }
      this.surfaceService.present(
        handle,
        (event as CustomEvent<SurfacePresentationIntent>).detail,
      );
    };
    let layout = (event: Event) => {
      event.stopPropagation();
      if (!this.surfaceService.has(handle)) {
        return;
      }
      this.surfaceService.layout(
        handle,
        (event as CustomEvent<SurfaceLayoutIntent>).detail,
      );
    };
    let observe = (event: Event) => {
      event.stopPropagation();
      if (!this.surfaceService.has(handle)) {
        return;
      }
      let intent = (event as CustomEvent<SurfaceObserveIntent>).detail;
      intent.connected(this.surfaceService.observe(handle, intent.callback));
    };
    element.addEventListener(surfacePresentationEvent, present);
    element.addEventListener(surfaceLayoutEvent, layout);
    element.addEventListener(surfaceObserveEvent, observe);
    return () => {
      element.removeEventListener(surfacePresentationEvent, present);
      element.removeEventListener(surfaceLayoutEvent, layout);
      element.removeEventListener(surfaceObserveEvent, observe);
      detach();
    };
  }
}
