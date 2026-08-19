import { tracked } from '@glimmer/tracking';

// Pure-TS pan/zoom engine for the board surface. "Rig" as in camera rig: the
// world stays put while RigState holds the camera (worldX/worldY/magnify) and
// SurfaceRig moves it with momentum. No DOM dependencies — consumers wire
// handleWheel / startPan to elements and render from RigState.
//
// API at a glance:
//   handleWheel(event)            wheel → pan; ctrl/cmd+wheel (pinch) → zoom at cursor
//   startPan(x, y) → PanSession   pointer drag; session.move(x, y) / session.end()
//   zoomAtPoint(factor, x, y)     programmatic zoom keeping a local point fixed
//   zoomCentered(factor, el?)     programmatic zoom around an element's center
//   startPanMomentum() / startZoomMomentum() / stopKineticPan() / stopZoomMomentum()
//   stopAll() / destroy()         cancel every momentum loop and pending timeout

// ── Constants ──────────────────────────────────────────────
export const MIN_ZOOM = 0.2; // default zoom clamp; override via SurfaceRigOptions
export const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.0032; // wheel delta → zoom ratio
const PINCH_ZOOM_BOOST = 1.7; // extra speed for pinch gestures
const PAN_INERTIA_DECAY = 0.9; // momentum decay per 60fps-normalized frame
const PAN_INERTIA_MIN_SPEED = 0.0008; // below this, pan momentum stops
const ZOOM_INERTIA_DECAY = 0.86; // zoom momentum dies faster than pan
const ZOOM_INERTIA_MIN_SPEED = 0.00008;
const MOMENTUM_START_DELAY_MS = 45; // idle time after last wheel before momentum

// ── RigState ───────────────────────────────────────────────
// The camera: starts at the origin, 100% zoom.
export class RigState {
  @tracked worldX = 0;
  @tracked worldY = 0;
  @tracked magnify = 1;
}

// ── PanSession ─────────────────────────────────────────────
export interface PanSession {
  move(clientX: number, clientY: number): void;
  end(): void;
}

// ── SurfaceRig engine ──────────────────────────────────────
export interface SurfaceRigOptions {
  minZoom?: number;
  maxZoom?: number;
  onChange?: () => void; // fired after every camera change
  isInteracting?: () => boolean; // true stops momentum loops (e.g. during a drag)
}

export class SurfaceRig {
  rig: RigState;
  private minZoom: number;
  private maxZoom: number;
  private onChange: (() => void) | undefined;
  private isInteracting: (() => boolean) | undefined;

  // Pan momentum state
  panVelocityX = 0;
  panVelocityY = 0;
  private kineticRafId: number | null = null;
  private kineticLastTime = 0;

  // Zoom momentum state
  zoomVelocity = 0;
  zoomAnchorX = 0;
  zoomAnchorY = 0;
  private zoomMomentumRafId: number | null = null;
  private zoomMomentumLastTime = 0;

  // Shared
  private momentumStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastWheelSampleTime = 0;

  // Pan session tracking
  private lastPanSampleTime = 0;
  private lastPanWorldX = 0;
  private lastPanWorldY = 0;

  constructor(rig: RigState, opts?: SurfaceRigOptions) {
    this.rig = rig;
    this.minZoom = opts?.minZoom ?? MIN_ZOOM;
    this.maxZoom = opts?.maxZoom ?? MAX_ZOOM;
    this.onChange = opts?.onChange;
    this.isInteracting = opts?.isInteracting;
  }

  // ── Wheel handler ──────────────────────────────────────

  handleWheel = (event: WheelEvent) => {
    this.clearMomentumStartTimeout();
    this.stopKineticPan();
    this.stopZoomMomentum();

    event.preventDefault();

    const rig = this.rig;
    const isZoom = event.ctrlKey || event.metaKey;
    const now = performance.now();
    const dt = Math.max(
      8,
      this.lastWheelSampleTime ? now - this.lastWheelSampleTime : 16,
    );
    this.lastWheelSampleTime = now;

    // Normalize line/page delta modes to pixels for both zoom and pan
    const deltaScale =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;

    if (isZoom) {
      const surface = event.currentTarget as HTMLElement | null;
      if (!surface) return;

      const rect = surface.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      const current = rig.magnify;
      const zoomStrength = ZOOM_SENSITIVITY * PINCH_ZOOM_BOOST;
      const next = clamp(
        current * Math.exp(-(event.deltaY * deltaScale) * zoomStrength),
        this.minZoom,
        this.maxZoom,
      );

      if (next === current) return;

      rig.worldX = rig.worldX + localX / next - localX / current;
      rig.worldY = rig.worldY + localY / next - localY / current;
      rig.magnify = next;

      this.zoomAnchorX = localX;
      this.zoomAnchorY = localY;
      this.zoomVelocity = Math.log(next / current) / dt;
      this.scheduleMomentumStart();
      this.onChange?.();
      return;
    }

    const panScale = deltaScale / rig.magnify;
    const dxWorld = -event.deltaX * panScale;
    const dyWorld = -event.deltaY * panScale;
    rig.worldX += dxWorld;
    rig.worldY += dyWorld;
    this.panVelocityX = dxWorld / dt;
    this.panVelocityY = dyWorld / dt;
    this.scheduleMomentumStart();
    this.onChange?.();
  };

  // ── Pointer pan session ────────────────────────────────

  startPan(startClientX: number, startClientY: number): PanSession {
    this.clearMomentumStartTimeout();
    this.stopKineticPan();
    this.stopZoomMomentum();

    const rig = this.rig;
    const startRigX = rig.worldX;
    const startRigY = rig.worldY;
    this.lastPanWorldX = rig.worldX;
    this.lastPanWorldY = rig.worldY;
    this.lastPanSampleTime = performance.now();
    this.panVelocityX = 0;
    this.panVelocityY = 0;

    return {
      move: (clientX: number, clientY: number) => {
        const dx = clientX - startClientX;
        const dy = clientY - startClientY;
        const nextWorldX = startRigX + dx / rig.magnify;
        const nextWorldY = startRigY + dy / rig.magnify;
        rig.worldX = nextWorldX;
        rig.worldY = nextWorldY;

        const now = performance.now();
        const dt = Math.max(1, now - this.lastPanSampleTime);
        this.panVelocityX = (nextWorldX - this.lastPanWorldX) / dt;
        this.panVelocityY = (nextWorldY - this.lastPanWorldY) / dt;
        this.lastPanWorldX = nextWorldX;
        this.lastPanWorldY = nextWorldY;
        this.lastPanSampleTime = now;
        this.onChange?.();
      },
      end: () => {
        this.startPanMomentum();
        this.onChange?.();
      },
    };
  }

  // ── Programmatic zoom (centered on element) ────────────
  // A programmatic zoom is an explicit camera command: stop momentum loops
  // and the pending momentum-start timeout first, so stale wheel/pinch
  // velocity can't resume afterwards and drift the camera off its target.

  zoomCentered(factor: number, el?: HTMLElement | null) {
    if (!el) {
      this.stopAll();
      this.rig.magnify = clamp(
        this.rig.magnify * factor,
        this.minZoom,
        this.maxZoom,
      );
      this.onChange?.();
      return;
    }
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    this.zoomAtPoint(factor, cx, cy);
  }

  zoomAtPoint(factor: number, localX: number, localY: number) {
    this.stopAll();
    const rig = this.rig;
    const oldZoom = rig.magnify;
    const newZoom = clamp(oldZoom * factor, this.minZoom, this.maxZoom);
    rig.worldX += localX / newZoom - localX / oldZoom;
    rig.worldY += localY / newZoom - localY / oldZoom;
    rig.magnify = newZoom;
    this.onChange?.();
  }

  // ── Momentum: pan ──────────────────────────────────────

  startPanMomentum() {
    const speed = Math.hypot(this.panVelocityX, this.panVelocityY);
    if (speed < PAN_INERTIA_MIN_SPEED) return;

    const step = (now: number) => {
      if (this.isInteracting?.()) {
        this.stopKineticPan();
        return;
      }

      if (!this.kineticLastTime) {
        this.kineticLastTime = now;
      }

      const dt = Math.max(1, now - this.kineticLastTime);
      this.kineticLastTime = now;

      const rig = this.rig;
      rig.worldX += this.panVelocityX * dt;
      rig.worldY += this.panVelocityY * dt;

      const decay = Math.pow(PAN_INERTIA_DECAY, dt / 16.67);
      this.panVelocityX *= decay;
      this.panVelocityY *= decay;

      const nextSpeed = Math.hypot(this.panVelocityX, this.panVelocityY);
      if (nextSpeed < PAN_INERTIA_MIN_SPEED) {
        this.stopKineticPan();
        return;
      }

      this.kineticRafId = requestAnimationFrame(step);
      this.onChange?.();
    };

    this.stopKineticPan(false);
    this.kineticRafId = requestAnimationFrame(step);
  }

  stopKineticPan(clearVelocity = true) {
    if (this.kineticRafId !== null) {
      cancelAnimationFrame(this.kineticRafId);
      this.kineticRafId = null;
    }
    this.kineticLastTime = 0;
    if (clearVelocity) {
      this.panVelocityX = 0;
      this.panVelocityY = 0;
    }
  }

  // ── Momentum: zoom ─────────────────────────────────────

  startZoomMomentum() {
    if (Math.abs(this.zoomVelocity) < ZOOM_INERTIA_MIN_SPEED) return;

    const step = (now: number) => {
      if (this.isInteracting?.()) {
        this.stopZoomMomentum();
        return;
      }

      if (!this.zoomMomentumLastTime) {
        this.zoomMomentumLastTime = now;
      }

      const dt = Math.max(1, now - this.zoomMomentumLastTime);
      this.zoomMomentumLastTime = now;

      const rig = this.rig;
      const current = rig.magnify;
      const next = clamp(
        current * Math.exp(this.zoomVelocity * dt),
        this.minZoom,
        this.maxZoom,
      );

      if (next === current) {
        this.stopZoomMomentum();
        return;
      }

      rig.worldX =
        rig.worldX + this.zoomAnchorX / next - this.zoomAnchorX / current;
      rig.worldY =
        rig.worldY + this.zoomAnchorY / next - this.zoomAnchorY / current;
      rig.magnify = next;

      const decay = Math.pow(ZOOM_INERTIA_DECAY, dt / 16.67);
      this.zoomVelocity *= decay;

      if (Math.abs(this.zoomVelocity) < ZOOM_INERTIA_MIN_SPEED) {
        this.stopZoomMomentum();
        return;
      }

      this.zoomMomentumRafId = requestAnimationFrame(step);
      this.onChange?.();
    };

    this.stopZoomMomentum(false);
    this.zoomMomentumRafId = requestAnimationFrame(step);
  }

  stopZoomMomentum(clearVelocity = true) {
    if (this.zoomMomentumRafId !== null) {
      cancelAnimationFrame(this.zoomMomentumRafId);
      this.zoomMomentumRafId = null;
    }
    this.zoomMomentumLastTime = 0;
    if (clearVelocity) {
      this.zoomVelocity = 0;
    }
  }

  // ── Momentum scheduling ────────────────────────────────

  scheduleMomentumStart() {
    this.clearMomentumStartTimeout();
    this.momentumStartTimeout = setTimeout(() => {
      this.momentumStartTimeout = null;
      this.startPanMomentum();
      this.startZoomMomentum();
    }, MOMENTUM_START_DELAY_MS);
  }

  clearMomentumStartTimeout() {
    if (this.momentumStartTimeout !== null) {
      clearTimeout(this.momentumStartTimeout);
      this.momentumStartTimeout = null;
    }
  }

  // ── Stop everything ────────────────────────────────────

  stopAll() {
    this.clearMomentumStartTimeout();
    this.stopKineticPan();
    this.stopZoomMomentum();
  }

  destroy() {
    this.stopAll();
  }
}

// ── Utility ──────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
