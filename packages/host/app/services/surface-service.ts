import Service from '@ember/service';

import {
  BOXEL_SURFACE_PROTOCOL_VERSION,
  type SurfaceHandle,
  type SurfaceLayout,
  type SurfaceObservation,
  type SurfacePresentation,
} from '@cardstack/runtime-common';

export interface SurfaceExecutionIdentity {
  mode: 'direct' | 'capsule' | 'sandbox';
  principal: string;
  surfaceId: string;
}

interface SurfaceRegistration {
  identity: SurfaceExecutionIdentity;
  element?: HTMLElement;
  attachment?: object;
  presentation: SurfacePresentation;
  layout: SurfaceLayout;
  observers: Set<(observation: SurfaceObservation) => void>;
  resizeObserver?: ResizeObserver;
  intersectionObserver?: IntersectionObserver;
  visible: boolean;
}

/**
 * Host-owned broker for browser presentation and layout capabilities.
 *
 * Receiving a SurfaceHandle is not DOM authority. Every operation resolves
 * the opaque handle here, where ownership, values, and element lifetime are
 * checked before the Host mutates its own document.
 */
export default class SurfaceService extends Service {
  readonly protocolVersion = BOXEL_SURFACE_PROTOCOL_VERSION;
  private nextHandle = 0;
  private surfaces = new Map<SurfaceHandle, SurfaceRegistration>();

  register(identity: SurfaceExecutionIdentity): SurfaceHandle {
    let handle = `surface:${++this.nextHandle}` as SurfaceHandle;
    this.surfaces.set(handle, {
      identity: structuredClone(identity),
      presentation: {},
      layout: { heightMode: 'intrinsic' },
      observers: new Set(),
      visible: true,
    });
    return handle;
  }

  identityFor(handle: SurfaceHandle): SurfaceExecutionIdentity {
    return structuredClone(this.registrationFor(handle).identity);
  }

  has(handle: SurfaceHandle): boolean {
    return this.surfaces.has(handle);
  }

  attach(handle: SurfaceHandle, element: HTMLElement): () => void {
    let registration = this.registrationFor(handle);
    let attachment = {};
    this.detachObservers(registration);
    registration.element = element;
    registration.attachment = attachment;
    this.applyPresentation(registration);
    this.applyLayout(registration);
    if (registration.observers.size > 0) {
      this.installObservers(registration);
      this.publishObservation(registration);
    }
    return () => {
      if (
        registration.element !== element ||
        registration.attachment !== attachment
      ) {
        return;
      }
      this.detachObservers(registration);
      registration.element = undefined;
      registration.attachment = undefined;
    };
  }

  present(handle: SurfaceHandle, presentation: SurfacePresentation): void {
    let registration = this.registrationFor(handle);
    registration.presentation = sanitizePresentation(presentation);
    this.applyPresentation(registration);
  }

  layout(handle: SurfaceHandle, layout: SurfaceLayout): void {
    let registration = this.registrationFor(handle);
    registration.layout = sanitizeLayout(layout);
    this.applyLayout(registration);
    this.publishObservation(registration);
  }

  observe(
    handle: SurfaceHandle,
    callback: (observation: SurfaceObservation) => void,
  ): () => void {
    let registration = this.registrationFor(handle);
    let wasEmpty = registration.observers.size === 0;
    registration.observers.add(callback);
    if (registration.element) {
      if (wasEmpty) {
        this.installObservers(registration);
      }
      callback(this.observationFor(registration));
    }
    return () => {
      registration.observers.delete(callback);
      if (registration.observers.size === 0) {
        this.detachObservers(registration);
      }
    };
  }

  release(handle: SurfaceHandle): void {
    let registration = this.surfaces.get(handle);
    if (!registration) {
      return;
    }
    this.detachObservers(registration);
    registration.observers.clear();
    this.surfaces.delete(handle);
  }

  willDestroy(): void {
    for (let registration of this.surfaces.values()) {
      this.detachObservers(registration);
    }
    this.surfaces.clear();
    super.willDestroy();
  }

  private registrationFor(handle: SurfaceHandle): SurfaceRegistration {
    let registration = this.surfaces.get(handle);
    if (!registration) {
      throw new Error(`Unknown or released Surface handle '${handle}'`);
    }
    return registration;
  }

  private applyPresentation(registration: SurfaceRegistration): void {
    let element = registration.element;
    if (!element) {
      return;
    }
    let { containerBackground, headerColor } = registration.presentation;
    element.style.setProperty(
      '--boxel-surface-container-background',
      containerBackground ?? '',
    );
    element.style.setProperty(
      '--boxel-surface-header-color',
      headerColor ?? '',
    );
  }

  private applyLayout(registration: SurfaceRegistration): void {
    let element = registration.element;
    if (!element) {
      return;
    }
    let { heightMode, minimumHeight } = registration.layout;
    element.dataset.boxelSurfaceHeightMode = heightMode;
    if (heightMode === 'allocated') {
      // The surface's owner (a fitted tile, a grid cell) allocates the box;
      // the surface fills whatever it was given and never influences it.
      element.style.height = '100%';
      element.style.minHeight = '';
      return;
    }
    // Intrinsic: the surface is exactly as tall as its content, which only
    // the renderer inside can measure (for a Sandbox, the parent cannot see
    // into the iframe). Until the first report arrives the element keeps
    // its natural height — sized by the in-flow placeholder while booting —
    // and each report then sets an EXPLICIT height, not a min-height: the
    // content measurement is scroll-height based (viewport-independent), so
    // one report converges instead of ratcheting against the current box.
    element.style.height = minimumHeight
      ? `${clampIntrinsicHeight(minimumHeight)}px`
      : '';
    element.style.minHeight = '';
  }

  private installObservers(registration: SurfaceRegistration): void {
    let element = registration.element;
    if (!element || registration.observers.size === 0) {
      return;
    }
    if (!registration.resizeObserver && typeof ResizeObserver !== 'undefined') {
      registration.resizeObserver = new ResizeObserver(() =>
        this.publishObservation(registration),
      );
      registration.resizeObserver.observe(element);
    }
    if (
      !registration.intersectionObserver &&
      typeof IntersectionObserver !== 'undefined'
    ) {
      registration.intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          registration.visible = entry?.isIntersecting ?? true;
          this.publishObservation(registration);
        },
      );
      registration.intersectionObserver.observe(element);
    }
  }

  private detachObservers(registration: SurfaceRegistration): void {
    registration.resizeObserver?.disconnect();
    registration.intersectionObserver?.disconnect();
    registration.resizeObserver = undefined;
    registration.intersectionObserver = undefined;
  }

  private publishObservation(registration: SurfaceRegistration): void {
    if (!registration.element || registration.observers.size === 0) {
      return;
    }
    let observation = this.observationFor(registration);
    for (let callback of registration.observers) {
      callback(structuredClone(observation));
    }
  }

  private observationFor(
    registration: SurfaceRegistration,
  ): SurfaceObservation {
    let rect = registration.element!.getBoundingClientRect();
    return {
      width: finiteDimension(rect.width),
      height: finiteDimension(rect.height),
      visible: registration.visible,
    };
  }
}

function finiteDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Bounds an intrinsic-height report before it reaches CSS: a floor so a
 * transiently-empty measurement can't collapse the surface to nothing, and
 * a ceiling so a runaway child (or a genuinely enormous card) can't grow
 * the host page without bound — past it, the child's own document scrolls.
 */
function clampIntrinsicHeight(height: number): number {
  return Math.max(40, Math.min(2400, Math.ceil(height)));
}

function sanitizePresentation(
  presentation: SurfacePresentation,
): SurfacePresentation {
  return {
    headerColor: safeCSSColor(presentation.headerColor),
    containerBackground: safeCSSColor(presentation.containerBackground),
  };
}

function safeCSSColor(value: string | null | undefined): string | null {
  if (value == null || value === '') {
    return null;
  }
  if (value.length > 128 || /[;{}]/.test(value)) {
    throw new Error('Surface presentation contains an invalid color');
  }
  if (typeof CSS !== 'undefined' && !CSS.supports('color', value)) {
    throw new Error('Surface presentation contains an invalid color');
  }
  return value;
}

function sanitizeLayout(layout: SurfaceLayout): SurfaceLayout {
  if (layout.heightMode !== 'intrinsic' && layout.heightMode !== 'allocated') {
    throw new Error(`Unsupported Surface height mode '${layout.heightMode}'`);
  }
  let minimumHeight = layout.minimumHeight;
  if (minimumHeight !== undefined) {
    if (!Number.isFinite(minimumHeight) || minimumHeight < 0) {
      throw new Error('Surface minimum height is outside the supported range');
    }
    // A very tall card is NOT malformed input — it is exactly the case the
    // intrinsic ceiling exists for. Rejecting it strands the surface at its
    // boot height (a ~150px crop of a 7000px card); clamping applies the
    // ceiling and lets the child's own document scroll past it.
    minimumHeight = clampIntrinsicHeight(minimumHeight);
  }
  return { heightMode: layout.heightMode, minimumHeight };
}

declare module '@ember/service' {
  interface Registry {
    'surface-service': SurfaceService;
  }
}
