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
    this.detachObservers(registration);
    registration.element = element;
    this.applyPresentation(registration);
    this.applyLayout(registration);
    this.installObservers(registration);
    this.publishObservation(registration);
    return () => {
      if (registration.element !== element) {
        return;
      }
      this.detachObservers(registration);
      registration.element = undefined;
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
    registration.observers.add(callback);
    if (registration.element) {
      callback(this.observationFor(registration));
    }
    return () => registration.observers.delete(callback);
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
    element.dataset.boxelSurfaceHeightMode = registration.layout.heightMode;
    let minimumHeight = registration.layout.minimumHeight;
    element.style.minHeight = minimumHeight ? `${minimumHeight}px` : '';
  }

  private installObservers(registration: SurfaceRegistration): void {
    let element = registration.element;
    if (!element) {
      return;
    }
    if (typeof ResizeObserver !== 'undefined') {
      registration.resizeObserver = new ResizeObserver(() =>
        this.publishObservation(registration),
      );
      registration.resizeObserver.observe(element);
    }
    if (typeof IntersectionObserver !== 'undefined') {
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
    if (!registration.element) {
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
  if (
    minimumHeight !== undefined &&
    (!Number.isFinite(minimumHeight) ||
      minimumHeight < 0 ||
      minimumHeight > 4096)
  ) {
    throw new Error('Surface minimum height is outside the supported range');
  }
  return { heightMode: layout.heightMode, minimumHeight };
}

declare module '@ember/service' {
  interface Registry {
    'surface-service': SurfaceService;
  }
}
