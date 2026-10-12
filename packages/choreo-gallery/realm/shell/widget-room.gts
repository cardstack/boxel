import type { Camera3DState } from '@cardstack/choreo';
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import type * as THREE from 'three';

import type { GalleryDemo, StageSignature } from '../demo';
import { cameraCss, perspective } from '../lib/css3d';
import { restWhenOff } from '../lib/onstage';
import { realmFile } from '../lib/realm-url';
import { type RoomControl, roomThumbstick } from '../lib/room-thumbstick';
import { three } from '../lib/three';
import { type CameraRun, moveRoomCamera } from '../lib/widget-camera';
import {
  galleryBays,
  galleryBrandStyle,
  galleryHome,
  galleryLayout,
  gallerySigns,
} from '../lib/widget-gallery-layout';
import { projectLiveTile } from '../lib/widget-live-projection';
import {
  type NarrationResult,
  narrationURL,
  playNarrationClip,
} from '../lib/widget-narration';
import { quickCameraPath, quickScore } from '../lib/widget-quick-tour';
import { roomGuide } from '../lib/widget-room-guide';
import { tileReady } from '../lib/widget-tile-ready';
import { tourStops } from '../lib/widget-tour';
import { guideDemo } from '../lib/widget-tour-actions';
import { BoxelGlyph } from './boxel-glyph';
import { ChoreoMark } from './choreo-mark';
import { ChoreoRoot } from './choreo-root';

/** a demo as the room hangs it: the card, its stage, and its URL */
export interface RoomDemo {
  Example: ComponentLike<StageSignature>;
  group: string;
  href: string;
  id: string;
  lede: string;
  title: string;
}

/** the room's demos, from the gallery's linked demo cards */
export function roomDemos(demos: GalleryDemo[]): RoomDemo[] {
  return demos.flatMap((demo) => {
    const Stage = (demo.constructor as typeof GalleryDemo).stage;
    return Stage && demo.slug
      ? [
          {
            id: demo.slug,
            title: demo.title ?? demo.slug,
            group: demo.group ?? '',
            lede: demo.lede ?? '',
            href: demo.id ?? '',
            Example: Stage,
          },
        ]
      : [];
  });
}

interface Signature {
  Args: {
    demos: RoomDemo[];
    /** the gallery's own URL, for the brand */
    homeHref: string;
  };
}

type Layout = ReturnType<typeof galleryLayout<RoomDemo>>;

/** the index of the last item that passes, or -1 */
function findLastIndex<T>(items: readonly T[], test: (item: T) => boolean) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (test(items[i]!)) {
      return i;
    }
  }
  return -1;
}

/** the last item that passes */
function findLast<T>(items: readonly T[], test: (item: T) => boolean) {
  return items[findLastIndex(items, test)];
}
type Entry = Layout['entries'][number];
const POSTER_ON = { opacity: 1 } as const;
const POSTER_WARM = { opacity: 0.999 } as const;
const POSTER_OFF = { opacity: 0 } as const;
const POSTER_COVER = { duration: 0 } as const;
const POSTER_HANDOFF = { duration: 0.14, ease: 'linear' } as const;
function writeStyle(el: HTMLElement, name: string, value: string) {
  if (el.style.getPropertyValue(name) !== value) {
    el.style.setProperty(name, value);
  }
}
export class WidgetRoom extends Component<Signature> {
  layout: Layout = galleryLayout(this.args.demos);
  entries = this.layout.entries;
  @tracked mountedIds = new Set<string>();
  @tracked private revealedIds = new Set<string>();
  @tracked private warmingIds = new Set<string>();
  private preparations = new Map<string, AbortController>();
  private activeTile?: string;
  private preparedNext?: string;
  posterTransition = (id: string) =>
    this.revealedIds.has(id) ? POSTER_HANDOFF : POSTER_COVER;
  private park(id: string) {
    // Cover with the preview before dropping the old live raster. These are
    // paint fences, not animation timing; a reversal cancels the parking.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (
          this.isDestroying ||
          this.activeTile === id ||
          this.preparedNext === id
        ) {
          return;
        }
        const canvas = this.tiles
          .get(id)
          ?.querySelector<HTMLElement>('.wr-live-canvas');
        if (canvas) {
          canvas.dataset.render = 'parked';
        }
      }),
    );
  }
  posterTarget = (id: string) =>
    this.revealedIds.has(id)
      ? POSTER_OFF
      : this.warmingIds.has(id)
        ? POSTER_WARM
        : POSTER_ON;
  private mount(id: string) {
    if (!this.mountedIds.has(id)) {
      this.mountedIds = new Set([...this.mountedIds, id]);
    }
  }
  private prepare(id: string, reveal = false) {
    const tile = this.tiles.get(id);
    const canvas = tile?.querySelector<HTMLElement>('.wr-live-canvas');
    if (!tile || !canvas) {
      return;
    }
    this.mount(id);
    canvas.dataset.render = 'warm';
    if (!reveal) {
      return;
    }
    this.preparations.get(id)?.abort();
    const controller = new AbortController();
    this.preparations.set(id, controller);
    tile.dataset.widgetReady = 'false';
    this.warmingIds = new Set([...this.warmingIds, id]);
    void tileReady(canvas, controller.signal).then((ready) => {
      if (!ready || this.isDestroying || this.activeTile !== id) {
        return;
      }
      tile.dataset.widgetReady = 'true';
      canvas.dataset.render = 'live';
      const content = tile.querySelector<HTMLElement>('.wr-live-content');
      if (content) {
        content.inert = false;
      }
      this.revealedIds = new Set([...this.revealedIds, id]);
      this.warmingIds = new Set([...this.warmingIds].filter((x) => x !== id));
      this.preparations.delete(id);
    });
  }
  private activate(id?: string) {
    if (id === this.activeTile) {
      return;
    }
    const previous = this.activeTile;
    this.activeTile = id;
    if (previous) {
      this.preparations.get(previous)?.abort();
      this.preparations.delete(previous);
      this.revealedIds = new Set(
        [...this.revealedIds].filter((x) => x !== previous),
      );
      this.warmingIds = new Set(
        [...this.warmingIds].filter((x) => x !== previous),
      );
      this.park(previous);
    }
    if (id) {
      this.prepare(id, true);
    }
  }
  isMounted = (id: string) => this.mountedIds.has(id);
  bays = galleryBays;
  architecture = this.layout.architecture;
  signs = gallerySigns;
  brandStyle = galleryBrandStyle;
  floorMark = this.layout.floorMark;
  stops = tourStops;
  /** the room's media, served by the realm beside it */
  assetRoot = realmFile('asset/');
  stylesheet = realmFile('asset/widget-room.css');
  @tracked compact = matchMedia('(max-width:650px)').matches;
  @tracked selected: Entry | null = null;
  @tracked quickMode = false;
  @tracked quickIndex = 0;
  @tracked quickFinished = false;
  private quickRaf = 0;
  quickChapters = quickScore.chapters;
  // Keep score timestamps in media seconds; one audio clock slows every cue.
  quickRate = 0.85;
  quickSeconds = Math.round(quickScore.duration / this.quickRate);
  get quickChapter() {
    return this.quickChapters[this.quickIndex]!;
  }
  get quickNumber() {
    return String(this.quickIndex + 1).padStart(2, '0');
  }
  @tracked live = false;
  @tracked drawer = false;
  @tracked query = '';
  @tracked activeBay = -1;
  @tracked touring = false;
  @tracked tourIndex = -1;
  @tracked savedStop = -1;
  private savedTime = 0;
  private checkpointKey = 'choreo-full-tour-v1';
  get fullTourLabel() {
    return this.savedStop >= 0 ? 'Resume full audio tour' : 'Full audio tour';
  }
  private saveTour = () => {
    if (this.quickMode || !this.touring || this.tourIndex < 0) {
      return;
    }
    this.savedStop = this.tourIndex;
    const stop = tourStops[this.tourIndex]!;
    this.savedTime = this.audio?.src.includes(`/${stop.id}.mp3`)
      ? this.audio.currentTime || 0
      : 0;
    try {
      localStorage.setItem(
        this.checkpointKey,
        JSON.stringify({
          id: stop.id,
          time: this.savedTime,
        }),
      );
    } catch {
      /* Storage may be unavailable; retain the in-memory checkpoint. */
    }
  };
  private clearTour = () => {
    this.savedStop = -1;
    this.savedTime = 0;
    try {
      localStorage.removeItem(this.checkpointKey);
    } catch {
      /* optional */
    }
  };
  restartTour = () => {
    this.stopGuide();
    this.clearTour();
    void this.playTour(0);
  };
  // Shipped narration is available before the optional auditions manifest loads.
  @tracked narrationAvailable = true;
  @tracked narrationPath = 'widget-tour/narration-george-fast-v1';
  @tracked audioIssue = false;
  @tracked viewportWidth = innerWidth;
  @tracked viewportHeight = innerHeight;
  private viewport?: HTMLElement;
  private worlds: HTMLElement[] = [];
  /** the host's three.js, loaded before the first paint */
  private T?: typeof THREE;
  private camera?: THREE.PerspectiveCamera;
  private pose: Camera3DState = galleryHome;
  private run?: CameraRun;
  private generation = 0;
  private audio?: HTMLAudioElement;
  private settleNarration?: (result: NarrationResult) => void;
  private guideGeneration = 0;
  private cancelDemo?: () => void;
  private tiles = new Map<string, HTMLElement>();
  registerTile = modifier((element: HTMLElement, [id]: [string]) => {
    this.tiles.set(id, element);
    return () => {
      this.preparations.get(id)?.abort();
      this.tiles.delete(id);
    };
  });
  get results() {
    const q = this.query.toLowerCase();
    return this.entries.filter((d) =>
      `${d.title} ${d.group}`.toLowerCase().includes(q),
    );
  }
  get count() {
    return this.entries.length;
  }
  get stop() {
    return tourStops[this.tourIndex];
  }
  get tourNumber() {
    return String(this.tourIndex + 1).padStart(2, '0');
  }
  get showWelcome() {
    return (
      !this.navigating &&
      !this.selected &&
      !this.quickMode &&
      this.activeBay < 0
    );
  }
  get nativeSize() {
    const demo = this.selected;
    const width = Math.floor(
      Math.min(demo?.width ?? 480, this.viewportWidth - 48),
    );
    const reserve = this.tourIndex >= 0 ? 300 : 220;
    const height = Math.floor(
      Math.min(
        demo?.height ?? 360,
        Math.max(180, this.viewportHeight - reserve),
      ),
    );
    return { width, height };
  }
  get nativeStyle() {
    const { width, height } = this.nativeSize;
    const top = Math.max(
      92,
      Math.floor(
        (this.viewportHeight - height - 60 - (this.tourIndex >= 0 ? 110 : 35)) /
          2,
      ),
    );
    return htmlSafe(
      `width:${width + 24}px;left:${Math.floor((this.viewportWidth - width - 24) / 2)}px;top:${top}px;--native-w:${width}px;--native-h:${height}px;`,
    );
  }
  /** the selected demo's own card, where its full page is */
  get fullUrl() {
    return this.selected?.href ?? '';
  }
  previewSource = (id: string) =>
    `${this.assetRoot}widget-previews/rendered-20260906/${this.viewportWidth < 600 ? 'phone/' : ''}${id}.jpg`;
  isSelected = (id: string) => this.selected?.id === id;
  search = (event: Event) => {
    this.query = (event.target as HTMLInputElement).value;
  };
  toggleDrawer = () => {
    this.drawer = !this.drawer;
  };
  roomThumbstick = roomThumbstick;
  @tracked navigating = false;
  beginNavigation = () => {
    this.stopGuide();
    ++this.generation;
    this.quickMode = false;
    this.tourIndex = -1;
    this.selected = null;
    this.live = false;
    this.activeBay = -1;
    this.navigating = true;
  };
  nudgeRoom = (kind: RoomControl, x: number, y: number, dt: number) => {
    const pose = this.pose;
    const look = { ...(pose.look ?? galleryHome.look) };
    const yaw = (pose.yaw * Math.PI) / 180;
    const pitch = (pose.pitch * Math.PI) / 180;
    const distance = 5600 * pose.dolly;
    if (kind === 'rotate') {
      // Keep the eye fixed. Only its look direction turns; an orbit would
      // incorrectly carry the viewer around the exhibition's center.
      const eye = {
        x: look.x + Math.sin(yaw) * Math.cos(pitch) * distance,
        y: look.y + Math.sin(pitch) * distance,
        z: look.z + Math.cos(yaw) * Math.cos(pitch) * distance,
      };
      const nextYaw = pose.yaw + x * dt * 55;
      const nextPitch = Math.max(-75, Math.min(75, pose.pitch + y * dt * 40));
      const a = (nextYaw * Math.PI) / 180,
        b = (nextPitch * Math.PI) / 180;
      this.paint({
        ...pose,
        yaw: nextYaw,
        pitch: nextPitch,
        look: {
          x: eye.x - Math.sin(a) * Math.cos(b) * distance,
          y: eye.y - Math.sin(b) * distance,
          z: eye.z - Math.cos(a) * Math.cos(b) * distance,
        },
      });
    } else if (kind === 'pan') {
      const rate = Math.max(300, distance * 0.45) * dt;
      look.x +=
        (Math.cos(yaw) * x - Math.sin(yaw) * Math.sin(pitch) * y) * rate;
      look.y += Math.cos(pitch) * y * rate;
      look.z +=
        (-Math.sin(yaw) * x - Math.cos(yaw) * Math.sin(pitch) * y) * rate;
      this.paint({ ...pose, look });
    } else {
      this.paint({
        ...pose,
        dolly: Math.max(0.06, Math.min(4, pose.dolly * Math.exp(y * dt))),
      });
    }
  };
  private paint = (pose: Camera3DState) => {
    this.pose = pose;
    const { T, camera } = this;
    if (!this.viewport || !T || !camera) {
      return;
    }
    const width = this.viewportWidth,
      height = this.viewportHeight;
    if (camera.aspect !== width / height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const look = pose.look ?? galleryHome.look,
      yaw = (pose.yaw * Math.PI) / 180,
      pitch = (pose.pitch * Math.PI) / 180,
      d = 5600 * pose.dolly;
    camera.position.set(
      look.x + Math.sin(yaw) * Math.cos(pitch) * d,
      look.y + Math.sin(pitch) * d,
      look.z + Math.cos(yaw) * Math.cos(pitch) * d,
    );
    camera.lookAt(look.x, look.y, look.z);
    camera.updateMatrixWorld();
    const focal = perspective(camera.projectionMatrix.elements, height);
    writeStyle(this.viewport, 'perspective', `${focal}px`);
    const transform = cameraCss(
      camera.matrixWorldInverse.elements,
      focal,
      width,
      height,
    );
    for (const world of this.worlds) {
      writeStyle(world, 'transform', transform);
    }
    // The guide's next gesture defines focus during a moving camera shot.
    // A neighbouring tile can be geometrically central while the hand is
    // already illustrating the next demo.
    const guidedId =
      this.quickMode && !this.quickFinished
        ? (findLast(
            quickScore.actions,
            (action) => action.at - 0.65 <= (this.audio?.currentTime ?? 0),
          )?.demo ?? quickScore.actions[0]?.demo)
        : undefined;
    let activeId = this.selected?.id ?? guidedId;
    let closest = Infinity;
    for (const entry of this.entries) {
      const tile = this.tiles.get(entry.id);
      if (!tile) {
        continue;
      }
      const selected = this.selected?.id === entry.id;
      const size = selected ? this.nativeSize : entry;
      const outerWidth = size.width + 24,
        outerHeight = size.height + 48;
      writeStyle(tile, 'width', `${outerWidth}px`);
      writeStyle(tile, '--live-height', `${size.height}px`);
      // Focus clips a viewport, never the demo's full expanded canvas.
      writeStyle(tile, '--canvas-height', `${entry.height}px`);
      const projection = projectLiveTile(
        T,
        camera,
        width,
        height,
        entry,
        outerWidth,
        outerHeight,
      );
      if (
        !this.selected &&
        !guidedId &&
        projection.visible &&
        focal / projection.depth > 0.3
      ) {
        const distance =
          projection.center.x ** 2 + (projection.center.y + 0.1) ** 2;
        if (distance < closest && distance < 0.5) {
          closest = distance;
          activeId = entry.id;
        }
      }
      writeStyle(
        tile,
        'visibility',
        projection.visible || selected ? 'visible' : 'hidden',
      );
      writeStyle(
        tile,
        'z-index',
        String(
          selected && this.live
            ? 40000
            : Math.max(1, Math.round(30000 - projection.depth)),
        ),
      );
      if (selected && this.live) {
        writeStyle(tile, 'transform', 'none');
        writeStyle(tile, 'left', `${Math.floor((width - outerWidth) / 2)}px`);
        writeStyle(
          tile,
          'top',
          `${Math.max(92, Math.floor((height - size.height - 60 - (this.tourIndex >= 0 ? 110 : 35)) / 2))}px`,
        );
      } else {
        writeStyle(tile, 'left', '0px');
        writeStyle(tile, 'top', '0px');
        if (projection.visible || selected) {
          writeStyle(tile, 'transform', projection.transform);
        }
      }
    }
    this.activate(activeId);
    const next =
      this.quickMode && !this.quickFinished
        ? quickScore.actions.find(
            (action) =>
              action.demo !== activeId &&
              action.at > (this.audio?.currentTime ?? 0) &&
              action.at < (this.audio?.currentTime ?? 0) + 2.4,
          )?.demo
        : undefined;
    if (next !== this.preparedNext) {
      if (this.preparedNext && this.preparedNext !== activeId) {
        const old = this.tiles
          .get(this.preparedNext)
          ?.querySelector<HTMLElement>('.wr-live-canvas');
        if (old) {
          old.dataset.render = 'parked';
        }
      }
      this.preparedNext = next;
      if (next) {
        this.prepare(next);
      }
    }
    for (const [id, tile] of this.tiles) {
      const active = id === activeId;
      if (tile.dataset.widgetActive !== String(active)) {
        tile.dataset.widgetActive = String(active);
      }
      // The focus hit area stays usable while the demo itself is inert.
      const content = tile.querySelector<HTMLElement>('.wr-live-content');
      if (content) {
        const inert = !active || tile.dataset.widgetReady !== 'true';
        if (content.inert !== inert) {
          content.inert = inert;
        }
      }
    }
  };
  private travel = async (target: Camera3DState, ms = 1450) => {
    if (!this.viewport) {
      return;
    }
    this.run?.cancel();
    const run = moveRoomCamera(this.pose, target, this.paint, ms);
    this.run = run;
    await run.finished;
  };
  private approach = async (entry: Entry) => {
    const token = ++this.generation;
    this.selected = entry;
    this.mount(entry.id);
    this.live = false;
    this.drawer = false;
    this.activeBay = entry.bay;
    const focal = this.viewportHeight / (2 * Math.tan((24 * Math.PI) / 180));
    const { height } = this.nativeSize;
    const projectedScale = 1;
    const distance = focal;
    const nativeTop = Math.max(
      92,
      Math.floor(
        (this.viewportHeight - height - 60 - (this.tourIndex >= 0 ? 110 : 35)) /
          2,
      ),
    );
    const centerY = nativeTop + (height + 48) / 2;
    await this.travel(
      {
        look: {
          x: entry.x,
          y: entry.y + (centerY - this.viewportHeight / 2) / projectedScale,
          z: entry.z,
        },
        dolly: distance / 5600,
        yaw: entry.yaw,
        pitch: 0,
        x: 0,
        y: 0,
      },
      this.tourIndex >= 0 ? 720 : 1450,
    );
    if (token === this.generation) {
      this.live = true;
      this.paint(this.pose);
    }
  };
  focus = (entry: Entry) => {
    this.stopGuide();
    this.quickMode = false;
    this.tourIndex = -1;
    void this.approach(entry);
  };
  overview = () => {
    this.navigating = false;
    this.stopGuide();
    this.quickMode = false;
    ++this.generation;
    this.tourIndex = -1;
    this.selected = null;
    this.live = false;
    this.activeBay = -1;
    void this.travel(galleryHome);
  };
  visitBay = (bay: (typeof galleryBays)[number]) => {
    this.stopGuide();
    this.quickMode = false;
    this.tourIndex = -1;
    ++this.generation;
    this.selected = null;
    this.live = false;
    this.activeBay = bay.index;
    void this.travel({
      look: { x: bay.x, y: 1280, z: bay.z },
      // Fit the complete bay and its physical sign on narrow screens.
      dolly: Math.max(
        0.64,
        (2700 * this.viewportHeight) /
          (2 * Math.tan((24 * Math.PI) / 180) * this.viewportWidth * 5600),
      ),
      yaw: bay.yaw,
      pitch: 2,
      x: 0,
      y: 0,
    });
  };
  next = () =>
    this.focus(
      this.entries[((this.selected?.index ?? -1) + 1) % this.entries.length]!,
    );
  previous = () =>
    this.focus(
      this.entries[
        ((this.selected?.index ?? 1) - 1 + this.entries.length) %
          this.entries.length
      ]!,
    );
  private stopGuide = () => {
    this.saveTour();
    ++this.guideGeneration;
    cancelAnimationFrame(this.quickRaf);
    this.cancelDemo?.();
    this.cancelDemo = undefined;
    this.touring = false;
    this.settleNarration?.('cancelled');
    this.settleNarration = undefined;
    this.audio?.pause();
    this.run?.cancel();
  };
  pauseTour = () => {
    if (this.quickMode) {
      this.touring = false;
      this.settleNarration?.('cancelled');
      this.settleNarration = undefined;
      this.audio?.pause();
      this.run?.pause();
    } else {
      this.stopGuide();
    }
  };
  startQuickTour = () => {
    if (this.quickMode && !this.quickFinished && this.run && this.audio) {
      this.playQuickNarration(this.audio.currentTime);
      return;
    }
    this.stopGuide();
    ++this.generation;
    const first = quickScore.actions[0];
    if (first) {
      this.mount(first.demo);
    }
    const room = this.viewport?.parentElement;
    const reset = (id: string, selector: string) =>
      room
        ?.querySelector<HTMLElement>(`[data-live-demo="${id}"] ${selector}`)
        ?.click();
    if (
      room?.querySelector('[data-live-demo="inline-edit"] [data-mode="edit"]')
    ) {
      reset('inline-edit', '.ie-toggle');
    }
    reset('lightbox', '[aria-label="Close"]');
    reset('sequence', '.study-card.is-open');
    reset('mockup', '[aria-label^="Close "]');
    reset('camera', '[aria-label="Pass"]');
    reset('hang', '.chip');
    const messages = [
      ...(room?.querySelectorAll<HTMLElement>(
        '[data-live-demo="inbox"] .mail-kill',
      ) ?? []),
    ];
    for (const button of messages.slice(0, Math.max(0, messages.length - 3))) {
      button.click();
    }
    this.quickMode = true;
    this.mount('mockup');
    this.quickFinished = false;
    this.quickIndex = 0;
    this.tourIndex = -1;
    this.selected = null;
    this.live = false;
    this.drawer = false;
    this.audioIssue = false;
    if (!this.viewport) {
      return;
    }
    const from = this.pose;
    const path = quickCameraPath(
      this.entries,
      from,
      this.viewportWidth,
      this.viewportHeight,
    );
    this.run = moveRoomCamera(
      from,
      path[path.length - 1]!,
      this.paint,
      quickScore.duration * 1000,
      path,
    );
    this.run.pause();
    const run = this.run;
    const audio = (this.audio ??= new Audio());
    this.cancelDemo = roomGuide(
      this.viewport.parentElement!,
      quickScore.actions,
      () => audio.currentTime,
      this.pauseTour,
      () => this.touring,
    );
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let reducedBeat = -1;
    const sync = () => {
      if (this.touring) {
        if (reduced) {
          const beat = Math.max(
            0,
            findLastIndex(
              quickScore.actions,
              (action) => action.at - 0.65 <= audio.currentTime,
            ),
          );
          if (beat !== reducedBeat) {
            reducedBeat = beat;
            const point = Math.max(
              0,
              Math.min(
                path.length - 1,
                Math.round(
                  (quickScore.actions[beat]!.at / quickScore.duration) *
                    path.length,
                ) - 1,
              ),
            );
            this.paint(path[point]!);
          }
        } else {
          run.time = audio.currentTime;
        }
        const index = findLastIndex(
          quickScore.chapters,
          (chapter) => chapter.at <= audio.currentTime,
        );
        if (index !== this.quickIndex) {
          this.quickIndex = Math.max(0, index);
        }
      }
      this.quickRaf = requestAnimationFrame(sync);
    };
    this.quickRaf = requestAnimationFrame(sync);
    this.playQuickNarration();
  };
  private playQuickNarration = (startAt = 0) => {
    const audio = (this.audio ??= new Audio());
    const token = this.guideGeneration;
    this.audioIssue = false;
    this.touring = true;
    audio.defaultPlaybackRate = this.quickRate;
    audio.playbackRate = this.quickRate;
    audio.preservesPitch = true;
    // Use the same recoverable media lifecycle as the separate full-tour clips.
    // This call stays synchronous with the visitor's tap for Safari permission.
    this.settleNarration = playNarrationClip(
      audio,
      `${this.assetRoot}${quickScore.audio}`,
      (result) => {
        if (token !== this.guideGeneration || result === 'cancelled') {
          return;
        }
        this.touring = false;
        if (result === 'ended') {
          this.quickFinished = true;
          this.cancelDemo?.();
          this.cancelDemo = undefined;
          cancelAnimationFrame(this.quickRaf);
          if (this.run) {
            this.run.time = quickScore.duration;
          }
        } else {
          this.audioIssue = true;
        }
      },
      startAt,
    );
  };
  startTour = () => {
    this.saveTour();
    void this.playTour(this.savedStop < 0 ? 0 : this.savedStop, this.savedTime);
  };
  nextStop = () => {
    void this.playTour(Math.min(tourStops.length - 1, this.tourIndex + 1));
  };
  private playNarration = (
    id: string,
    startAt = 0,
  ): Promise<NarrationResult> => {
    const audio = (this.audio ??= new Audio());
    return new Promise<NarrationResult>((resolve) => {
      this.settleNarration = playNarrationClip(
        audio,
        `${this.assetRoot}${this.narrationPath}/${id}.mp3`,
        resolve,
        startAt,
      );
    });
  };
  private playTour = async (start: number, startAt = 0) => {
    this.stopGuide();
    this.quickMode = false;
    this.drawer = false;
    const audio = (this.audio ??= new Audio());
    audio.defaultPlaybackRate = 1;
    audio.playbackRate = 1;
    const token = ++this.guideGeneration;
    this.touring = true;
    this.audioIssue = false;
    for (let index = start; index < tourStops.length; index++) {
      if (token !== this.guideGeneration) {
        return;
      }
      this.audioIssue = false;
      this.tourIndex = index;
      if (index === start) {
        this.mount('mockup');
      }
      const stop = tourStops[index]!;
      const offset = index === start ? startAt : 0;
      const started = performance.now() - offset * 1000;
      const next = tourStops[index + 1];
      if (next && this.narrationAvailable) {
        void fetch(
          narrationURL(`${this.assetRoot}${this.narrationPath}/${next.id}.mp3`),
          {
            cache: 'force-cache',
          },
        ).catch(() => {});
      }
      this.cancelDemo?.();
      this.cancelDemo = guideDemo(
        stop.id,
        () =>
          this.live && this.selected
            ? (this.tiles
                .get(this.selected.id)
                ?.querySelector<HTMLElement>('.wr-live-content') ?? null)
            : null,
        () => (performance.now() - started) / 1000,
        this.pauseTour,
      );
      // Start within the tap gesture, before asynchronous camera travel.
      const narration = this.narrationAvailable
        ? this.playNarration(stop.id, offset)
        : null;
      await this.approach(this.entries.find((d) => d.id === stop.id)!);
      if (token !== this.guideGeneration) {
        return;
      }
      if (narration) {
        const finished = await narration;
        if (token !== this.guideGeneration) {
          return;
        }
        if (finished === 'blocked' || finished === 'cancelled') {
          this.cancelDemo?.();
          this.audioIssue = true;
          this.touring = false;
          return;
        }
        // An unavailable clip keeps its written narration on screen, then
        // proceeds to the next separate clip instead of stopping the tour.
        this.audioIssue = finished === 'unavailable';
        const remaining = stop.seconds * 1000 - (performance.now() - started);
        if (remaining > 0) {
          await this.travel(this.pose, remaining);
        }
      } else {
        // The same Choreo clock holds the viewpoint for this readable script beat.
        const duration = Math.max(
          stop.seconds * 1000,
          (stop.text.split(/\s+/).length / 2.45) * 1000,
        );
        await this.travel(this.pose, duration);
      }
    }
    if (token === this.guideGeneration) {
      this.cancelDemo?.();
      this.touring = false;
      this.clearTour();
    }
  };
  private setup = modifier((el: Element) => {
    this.viewport = el as HTMLElement;
    try {
      const saved = JSON.parse(
        localStorage.getItem(this.checkpointKey) ?? 'null',
      );
      const index = tourStops.findIndex((stop) => stop.id === saved?.id);
      if (index >= 0 && Number.isFinite(saved.time) && saved.time >= 0) {
        this.savedStop = index;
        this.savedTime = saved.time;
      }
    } catch {
      /* A stale or unavailable checkpoint starts a fresh tour. */
    }
    const audio = (this.audio ??= new Audio());
    audio.addEventListener('timeupdate', this.saveTour);
    window.addEventListener('pagehide', this.saveTour);
    this.worlds = [...el.querySelectorAll<HTMLElement>('.wr-world')];
    // the projection is three's camera, which loads with the room
    let alive = true;
    void three().then(({ THREE: T }) => {
      if (!alive) {
        return;
      }
      this.T = T;
      this.camera = new T.PerspectiveCamera(48, 1, 1, 50000);
      this.paint(this.pose);
    });
    const resize = new ResizeObserver(() => {
      this.viewportWidth = el.clientWidth;
      this.viewportHeight = el.clientHeight;
      this.compact = el.clientWidth <= 650;
      if (this.selected) {
        void this.approach(this.selected);
      } else {
        this.paint(this.pose);
      }
    });
    resize.observe(el);
    // Distant tiles use previews. Live trees are mounted only on approach and
    // retained thereafter; hidden content does not join layout or painting.
    //
    // The keys are the room's own: it listens on its shell, not the window,
    // so they never reach the host's shortcuts.
    const shell = el.closest<HTMLElement>('.wr-shell') ?? (el as HTMLElement);
    const key = (event: Event) => {
      const e = event as KeyboardEvent;
      if ((e.target as HTMLElement).matches('input,textarea,select')) {
        return;
      }
      if (e.key === 'Escape') {
        this.overview();
      }
      if (e.key === 'ArrowRight') {
        this.next();
      }
      if (e.key === 'ArrowLeft') {
        this.previous();
      }
    };
    shell.addEventListener('keydown', key);
    void fetch(`${this.assetRoot}widget-tour/voices.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !this.isDestroying) {
          this.narrationAvailable = data.narrationReady;
          this.narrationPath = data.narrationPath ?? 'widget-tour/narration';
        }
      })
      .catch(() => {});
    return () => {
      this.stopGuide();
      audio.removeEventListener('timeupdate', this.saveTour);
      window.removeEventListener('pagehide', this.saveTour);
      ++this.generation;
      alive = false;
      for (const controller of this.preparations.values()) {
        controller.abort();
      }
      this.preparations.clear();
      resize.disconnect();
      shell.removeEventListener('keydown', key);
    };
  });

  <template>
    <link rel='stylesheet' href={{this.stylesheet}} />
    {{! the room is dark whatever the gallery's theme: its stages are lit
        against the room's walls, not the page }}
    <ChoreoRoot class='wr-root' data-theme='dark'>
      <section
        class='{{if this.quickMode "is-quick-tour"}}
          wr-shell
          {{if this.live "is-live"}}
          {{if this.selected "has-selection"}}
          {{if this.stop "has-guide"}}'
        aria-label='Choreo spatial demo room'
      >
        <div class='wr-viewport' {{this.setup}}>
          <div class='wr-scene-layer'><div class='wr-world'>
              {{#each this.architecture as |surface|}}<div
                  class='wr-plane wr-surface wr-{{surface.name}}'
                  style={{surface.style}}
                ></div>{{/each}}
              {{#each this.signs as |sign|}}<div
                  class='wr-plane wr-bay-sign'
                  style={{sign.style}}
                  data-gallery-sign={{sign.index}}
                ><b>{{sign.number}}</b><span><small
                    >{{sign.discipline}}</small><strong
                    >{{sign.name}}</strong></span></div>{{/each}}
              <div
                class='wr-plane wr-architectural-brand'
                style={{this.brandStyle}}
              ><ChoreoMark /><strong>Choreo</strong><span>Motion,<br
                  />choreographed.</span><small>BY CARDSTACK</small></div>
              <div
                class='wr-plane wr-floor-mark'
                style={{this.floorMark}}
              ><ChoreoMark /><span>INTERACTION / SPACE / STORY</span></div>
            </div></div>
        </div>
        <div class='wr-live-collection'>
          {{#each this.entries key='id' as |demo|}}
            <article
              class='wr-live-tile
                {{if (this.isSelected demo.id) "selected"}}
                {{if this.live "settled"}}'
              data-widget-active='false'
              data-widget-id={{demo.id}}
              data-native-width={{demo.width}}
              data-native-height={{demo.height}}
              {{this.registerTile demo.id}}
            >
              <div
                class='wr-live-content'
                data-live-demo={{demo.id}}
                data-test-widget-embed
              >
                <div
                  class='wr-live-canvas'
                  data-render='parked'
                  {{restWhenOff}}
                >
                  {{! the stage face: a film plays in its own frame here, as
                      on its demo page, rather than showing its gallery poster }}
                  {{#if (this.isMounted demo.id)}}{{#let
                      demo.Example
                      as |Example|
                    }}<Example @face='stage' />{{/let}}{{/if}}
                </div>
                <img
                  class='wr-tile-preview'
                  src={{this.previewSource demo.id}}
                  alt=''
                  draggable='false'
                  decoding='async'
                  {{motion
                    initial=POSTER_ON
                    animate=(this.posterTarget demo.id)
                    transition=(this.posterTransition demo.id)
                  }}
                />
              </div>
              {{#unless (this.isSelected demo.id)}}<button
                  type='button'
                  class='wr-live-hit'
                  aria-label={{concat 'Explore ' demo.title}}
                  {{on 'click' (fn this.focus demo)}}
                ></button>{{/unless}}
              <div class='wr-live-label'><span>{{demo.title}}</span><small>{{if
                    (this.isSelected demo.id)
                    'LIVE · 100%'
                    demo.group
                  }}</small></div>
            </article>
          {{/each}}
        </div>
        <nav class='wr-navigation' aria-label='3D room navigation'>
          <button
            type='button'
            class='wr-stick'
            aria-label='Rotate room'
            title='Drag to rotate around your viewpoint. Arrow keys also work.'
            {{this.roomThumbstick 'rotate' this.beginNavigation this.nudgeRoom}}
          ><span class='wr-stick-dot'></span><span
              class='wr-stick-name'
            >Rotate</span></button>
          <button
            type='button'
            class='wr-stick'
            aria-label='Pan room'
            title='Drag to pan. Arrow keys also work.'
            {{this.roomThumbstick 'pan' this.beginNavigation this.nudgeRoom}}
          ><span class='wr-stick-dot'></span><span
              class='wr-stick-name'
            >Pan</span></button>
          <button
            type='button'
            class='wr-stick wr-zoom'
            aria-label='Zoom room'
            title='Drag up to move closer, down to move away. Use up and down arrow keys.'
            {{this.roomThumbstick 'zoom' this.beginNavigation this.nudgeRoom}}
          ><span class='wr-stick-dot'></span><span
              class='wr-stick-name'
            >Zoom</span></button>
          <button
            type='button'
            class='wr-navigation-reset'
            {{on 'click' this.overview}}
          >Reset view</button>
        </nav>
        <header class='wr-header'><a
            class='wr-brand'
            href={{@homeHref}}
            aria-label='Choreo home'
          ><ChoreoMark /><span><strong>Choreo</strong><small>BY CARDSTACK</small></span></a><div
            class='wr-header-actions'
          >{{#unless this.touring}}<button
                type='button'
                {{on 'click' this.startTour}}
              >{{this.fullTourLabel}}</button>{{/unless}}<button
              type='button'
              aria-expanded={{this.drawer}}
              {{on 'click' this.toggleDrawer}}
            >All
              {{this.count}}
              demos
              <BoxelGlyph @name='menu' /></button></div></header>
        {{#if this.showWelcome}}<div class='wr-intro'><span
              class='wr-eyebrow'
            >THE CHOREO ATELIER / OPEN COLLECTION</span><h1>Feel the change.<br
              />Enter the story.</h1><p>Forty-six living studies in interaction,
              space, and film.</p><div><button
                type='button'
                class='wr-primary'
                {{on 'click' this.startQuickTour}}
              >{{this.quickSeconds}}-second highlights
                <BoxelGlyph @name='arrow-up-right' /></button><button
                type='button'
                class='wr-explore'
                {{on 'click' this.next}}
              >Explore freely</button><button
                type='button'
                class='wr-explore'
                {{on 'click' this.startTour}}
              >{{this.fullTourLabel}}</button></div></div>{{/if}}
        {{#if this.drawer}}<aside class='wr-drawer' aria-label='All demos'><div
              class='wr-drawer-head'
            ><h2>The collection <small>{{this.count}}</small></h2><button
                type='button'
                aria-label='Close collection'
                {{on 'click' this.toggleDrawer}}
              ><BoxelGlyph @name='x' /></button></div><input
              aria-label='Search demos'
              placeholder='Find a demo or motion pattern…'
              value={{this.query}}
              {{on 'input' this.search}}
            /><div class='wr-results'>{{#each this.results as |demo|}}<button
                  type='button'
                  data-demo-choice={{demo.id}}
                  {{on 'click' (fn this.focus demo)}}
                ><img src={{this.previewSource demo.id}} alt='' /><span
                  >{{demo.title}}<small>{{demo.group}}</small></span><span
                  ><BoxelGlyph
                      @name='arrow-up-right'
                    /></span></button>{{else}}<p>No demos match this search.</p>{{/each}}</div></aside>{{/if}}
        {{#if this.quickMode}}<section
            class='wr-guide-plane wr-quick-guide'
            aria-label='Quick tour narration'
            aria-live='polite'
          >
            <div class='wr-guide-number'>{{this.quickNumber}}<small>/ 05</small></div>
            <div class='wr-guide-copy'><span
                class='wr-eyebrow'
              >{{this.quickChapter.category}}</span><h2
              >{{this.quickChapter.title}}</h2><p
              >{{this.quickChapter.text}}</p><small>{{if
                  this.quickFinished
                  'Tour complete · Explore any live demo'
                  'A continuous tour of the good stuff'
                }}</small></div>
            <div class='wr-guide-controls'>{{#if this.touring}}<button
                  type='button'
                  {{on 'click' this.pauseTour}}
                >Pause</button>{{else}}<button
                  type='button'
                  {{on 'click' this.startQuickTour}}
                >{{if
                    this.audioIssue
                    'Tap to play audio'
                    (if this.quickFinished 'Replay highlights' 'Resume')
                  }}</button>{{/if}}<button
                type='button'
                {{on 'click' this.overview}}
              >Explore room</button></div>
          </section>{{else}}{{#if this.stop}}<section
              class='wr-guide-plane'
              aria-label='Guided tour narration'
              aria-live='polite'
            ><div class='wr-guide-number'>{{this.tourNumber}}<small>/
                  {{this.stops.length}}</small></div><div
                class='wr-guide-copy'
              ><span class='wr-eyebrow'>{{this.stop.chapter}}</span><h2
                >{{this.stop.title}}</h2><p>{{this.stop.text}}</p><small
                >{{this.stop.cue}}</small></div><div
                class='wr-guide-controls'
              >{{#if this.touring}}<button
                    type='button'
                    {{on 'click' this.pauseTour}}
                  >Pause tour</button>{{else}}<button
                    type='button'
                    {{on 'click' this.startTour}}
                  >{{if
                      this.audioIssue
                      'Tap to play audio'
                      'Resume tour'
                    }}</button>{{/if}}<button
                  type='button'
                  {{on 'click' this.nextStop}}
                >Next stop <BoxelGlyph @name='arrow-right' /></button><button
                  type='button'
                  {{on 'click' this.restartTour}}
                >Restart tour</button><button
                  type='button'
                  {{on 'click' this.overview}}
                >Leave tour</button></div></section>
          {{else}}<footer class='wr-footer'>{{#if this.selected}}<div
                  class='wr-detail'
                ><span class='wr-eyebrow'>{{this.selected.group}}
                    / LIVE STUDY</span><h2>{{this.selected.title}}</h2><p
                  >{{this.selected.lede}}</p></div><nav
                  class='wr-controls'
                  aria-label='Room controls'
                ><button
                    type='button'
                    aria-label='Previous demo'
                    {{on 'click' this.previous}}
                  ><BoxelGlyph @name='arrow-left' /></button><button
                    type='button'
                    {{on 'click' this.overview}}
                  >Gallery</button><a
                    href={{this.fullUrl}}
                    target='_blank'
                    rel='noopener noreferrer'
                  >Full demo <BoxelGlyph @name='arrow-up-right' /></a><button
                    type='button'
                    aria-label='Next demo'
                    {{on 'click' this.next}}
                  ><BoxelGlyph @name='arrow-right' /></button></nav>{{else}}<nav
                  class='wr-bays'
                  aria-label='Gallery wings'
                >{{#each this.bays as |bay|}}<button
                      type='button'
                      {{on 'click' (fn this.visitBay bay)}}
                    ><small
                      >{{bay.number}}</small>{{bay.name}}</button>{{/each}}</nav>{{/if}}</footer>{{/if}}
        {{/if}}
      </section>
    </ChoreoRoot>
    <style scoped>
      .wr-root {
        position: relative;
        height: 100%;
        min-height: 640px;
      }
    </style>
  </template>
}
