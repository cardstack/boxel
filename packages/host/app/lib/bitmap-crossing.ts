import { animateView, type ViewTransitionOptions } from 'glimmer-motion';

import { prepareBitmapShadow } from './bitmap-shadow';
import {
  boundaryEase,
  inspectionSpeed,
  motionDurations,
  motionEase,
} from './motion-timing';
import { traceMotionPhase } from './motion-trace';

let underlaySequence = 0;

// Measure each part before any capture writes. The title's flex box changes
// independently of its glyphs, so use font size for its uniform raster scale.
// The realm image uses its own measured width, never the header's scale.
function headerParts(underlay?: HTMLElement) {
  return [
    ['.card-type-display-name', 'boxel-stack-title'],
    ['.realm-icon', 'boxel-stack-icon'],
  ].flatMap(([selector, layer]) => {
    selector = `.stack-item-header ${selector}`;
    let source = underlay?.querySelector<HTMLElement>(selector);
    if (!source) return [];
    let size = (element: HTMLElement) =>
      layer === 'boxel-stack-title'
        ? parseFloat(getComputedStyle(element).fontSize)
        : element.getBoundingClientRect().width;
    return [
      {
        source,
        selector,
        layer,
        size,
        from: size(source),
        transform: ['scale(1)', 'scale(1)'],
      },
    ];
  });
}

// Motion's retimed pseudo-element animations fill forwards, so the document
// keeps every finished one alive after its transition ends: about 34 per
// crossing, accumulating for the session. Only finished ones are released;
// a newer crossing's running animations are untouched.
function releaseFinishedViewAnimations() {
  for (let animation of document.getAnimations()) {
    if (
      animation.playState === 'finished' &&
      (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
        '::view-transition',
      )
    ) {
      animation.cancel();
    }
  }
}

function viewTransitionPlaying() {
  return document
    .getAnimations()
    .some((animation) =>
      (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
        '::view-transition',
      ),
    );
}

// The browser skips a view transition when its snapshot viewport resizes and
// cancels the pseudo-element animations without settling motion's `finished`.
// Waiting on that alone would leave the destination body unmounted. Settle
// once the browser has dropped the transition, or when the clock has
// certainly run out.
function playbackSettled(
  run: { finished: Promise<void>; complete: () => void },
  // seconds, like every crossing duration
  duration: number,
) {
  return new Promise<void>((resolve) => {
    let resizeCheck: ReturnType<typeof setTimeout> | undefined;
    let settle = () => {
      clearTimeout(deadline);
      clearTimeout(resizeCheck);
      window.removeEventListener('resize', onResize);
      resolve();
    };
    // A resize does not always skip (mobile toolbars change the window size
    // but not the snapshot viewport), so look before settling.
    let onResize = () => {
      clearTimeout(resizeCheck);
      resizeCheck = setTimeout(() => {
        if (!viewTransitionPlaying()) settle();
      }, 100);
    };
    let deadline = setTimeout(
      () => {
        try {
          run.complete();
        } finally {
          settle();
        }
      },
      duration * 1000 + 500,
    );
    window.addEventListener('resize', onResize);
    run.finished.then(settle, settle);
  });
}

export function supportsBitmapCrossing() {
  return (
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// A layer around the card crossing. 'out' fades a departing scene over the
// first part of the move, 'in' fades an arriving scene in from a quarter of
// the way, and 'morph' crosses a persistent element's two faces while its
// frame moves (a neighbouring stack taking freed width). 'rise' scales and
// fades an arriving scene up out of the crossing card, centred on the card's
// moving frame the whole way, and 'fall' the reverse: the workspace's
// platter of cards arriving from the middle of its dashboard tile.
export interface CrossingScene {
  selector: string;
  fade: 'in' | 'out' | 'morph' | 'rise' | 'fall';
  // 'rise' and 'fall': an element whose size the scene starts from (or ends
  // at), found from the card face in its own document: the departing face
  // for 'rise', the landing face for 'fall'. The tile's realm icon, so the
  // platter starts no bigger than the icon it appears behind. Without one it
  // scales from 60%.
  seed?: (face: HTMLElement) => HTMLElement | null | undefined;
}

const unseededScale = 0.6;

// The frame's centre travels with the crossing card on the boundary spring
// while the scene scales from its seed's size. Rising, it is opaque by 40%;
// falling, gone by 70%. Sampled so opacity and geometry keep separate
// windows in one keyframe list.
function platterKeyframes(
  arriving: boolean,
  layer?: DOMRect,
  frame?: DOMRect,
  seed?: DOMRect,
) {
  let clamp = (value: number) => Math.min(1, Math.max(0, value));
  let start =
    layer && seed
      ? clamp(
          (1.2 * Math.max(seed.width, seed.height)) /
            Math.max(layer.width, layer.height),
        )
      : unseededScale;
  let dx =
    layer && frame ? frame.x + frame.width / 2 - layer.x - layer.width / 2 : 0;
  let dy =
    layer && frame
      ? frame.y + frame.height / 2 - layer.y - layer.height / 2
      : 0;
  let times: number[] = [];
  let opacity: number[] = [];
  let transform: string[] = [];
  let steps = 24;
  for (let step = 0; step <= steps; step++) {
    let t = step / steps;
    let grown = arriving ? boundaryEase(t) : 1 - boundaryEase(t);
    let away = 1 - grown;
    times.push(t);
    opacity.push(arriving ? clamp((t - 0.05) / 0.35) : 1 - clamp(t / 0.7));
    transform.push(
      `translate(${(away * dx).toFixed(2)}px, ${(away * dy).toFixed(2)}px) scale(${(start + (1 - start) * grown).toFixed(4)})`,
    );
  }
  return {
    keyframes: { opacity, transform },
    options: { times, ease: 'linear' as const },
  };
}

// A small object crossing alongside the card as a matched layer of its own
// (a realm icon travelling between a dashboard tile and a card header).
export interface CrossingCompanion {
  from: HTMLElement;
  // Found after the update, from the landing face when there is one.
  // Nothing means the companion fades out.
  to: (landing: HTMLElement | undefined) => HTMLElement | null | undefined;
}

export interface BitmapCrossing {
  // The departing face: its snapshot is where the move starts.
  from: HTMLElement;
  // The landing face, looked up once the update has run. Nothing (the tile
  // scrolled away or was removed) means the departing face simply fades.
  to: () => HTMLElement | null | undefined;
  // Applies the navigation between the old and new captures.
  update: () => void | Promise<void>;
  // Seconds, before inspection slow-motion is applied.
  duration?: number;
  ease?: ViewTransitionOptions['ease'];
  // 'crossfade' blends the faces across the move; 'late' keeps the departing
  // face until near the landing so a face growing into a wider layout is
  // never squeezed.
  handoff?: 'crossfade' | 'late';
  // A card trading depth with `from` (its stack parent): its tray, body,
  // header and title move as matched layers of their own.
  parent?: HTMLElement;
  scenes?: CrossingScene[];
  companions?: CrossingCompanion[];
  // 'stationary' holds the top bar and edge controls still above the move.
  // 'crossfade' trades them, for a crossing between surfaces with different
  // chrome (the dashboard and a workspace).
  chrome?: 'stationary' | 'crossfade';
  // Receives a finish() that jumps playback to its end; the host calls it
  // when a newer scene takes over.
  onReady?: (finish: () => void) => void;
}

// The browser captures both faces as raster layers. Their shared frame morphs,
// while object-fit: cover keeps each bitmap proportional and crops the excess.
// No live card tree is resized or independently stretched on either axis.
export async function crossfadeCardBitmap({
  from: source,
  to,
  update,
  duration = motionDurations.crossing,
  ease = motionEase,
  handoff = 'crossfade',
  parent: underlay,
  scenes = [],
  companions = [],
  chrome = 'stationary',
  onReady,
}: BitmapCrossing) {
  if (
    !supportsBitmapCrossing() ||
    !source.isConnected ||
    duration === 0 ||
    document.querySelector('dialog[open], [aria-modal="true"]')
  ) {
    await update();
    return;
  }
  let updated = false;
  let crossingKey = `crossing-${++underlaySequence}`;
  let landingSelector = `[data-bitmap-landing="${crossingKey}"]`;
  let landing: HTMLElement | undefined;
  let underlayKey: string | undefined;
  let bodyFrame: HTMLElement | undefined;
  let shadow: ReturnType<typeof prepareBitmapShadow> | undefined;
  traceMotionPhase('capture-start');
  try {
    // Read the retained body's size before shadow setup/name assignment writes
    // to the document. A read after those writes forces the entire authored
    // catalog to lay out again in the click handler.
    let body = underlay?.querySelector<HTMLElement>(
      ':scope > .stack-item-content',
    );
    let opening = !!underlay?.contains(source);
    // A leaving source usually holds focus (its Close button was just
    // clicked). Removing a focused element runs focus fixup, which
    // recalculates style synchronously in the middle of the update. Release
    // it while style is still clean; focus would land on <body> anyway.
    let focused = document.activeElement;
    if (
      !opening &&
      focused instanceof HTMLElement &&
      source.contains(focused)
    ) {
      focused.blur();
    }
    let bodySize =
      body && opening
        ? { width: body.offsetWidth, height: body.offsetHeight }
        : undefined;
    // A rising platter centres on the departing face and starts at its
    // seed's size; a falling one needs its own box before the update.
    let departing = scenes.some((scene) => scene.fade === 'rise')
      ? source.getBoundingClientRect()
      : undefined;
    let risingSeeds = new Map(
      scenes
        .filter((scene) => scene.fade === 'rise')
        .map((scene) => [scene, scene.seed?.(source)?.getBoundingClientRect()]),
    );
    let fallingLayers = new Map(
      scenes
        .filter((scene) => scene.fade === 'fall')
        .map((scene) => [
          scene,
          document.querySelector(scene.selector)?.getBoundingClientRect(),
        ]),
    );
    let parts = headerParts(underlay);
    shadow = prepareBitmapShadow(source);
    // Keep document-scoped capture: Chromium 153 can abort element-scoped
    // capture when Ember replaces the named source node during the update.
    let builder = animateView(
      async () => {
        updated = true;
        traceMotionPhase('update-start');
        await update();
        landing = to() ?? undefined;
        landing?.setAttribute('data-bitmap-landing', crossingKey);
        traceMotionPhase('update-rendered');
        for (let part of parts) {
          let target = underlay?.querySelector<HTMLElement>(part.selector);
          if (!target) continue;
          let to = part.size(target);
          // The builder consumes these keyframes after destination capture.
          // Only the raster transform animates; live font/layout is final.
          part.transform[0] = `scale(${to > 0 ? part.from / to : 1})`;
        }
        // Stacking: the parent's header enters its buried strip as a new
        // layer only; it is not matched to where it used to be.
        if (opening && underlayKey)
          underlay
            ?.querySelector<HTMLElement>('.stack-item-header')
            ?.setAttribute('data-bitmap-header-entry', underlayKey);
        traceMotionPhase('header-measured');
        for (let scene of scenes) {
          let target = builder.targets.get(scene.selector);
          if (!target) continue;
          if (scene.fade === 'rise') {
            let layer = document.querySelector(scene.selector);
            if (layer) {
              let { keyframes, options } = platterKeyframes(
                true,
                layer.getBoundingClientRect(),
                departing,
                risingSeeds.get(scene),
              );
              target.new = { keyframes, options };
            }
          } else if (scene.fade === 'fall' && landing) {
            let { keyframes, options } = platterKeyframes(
              false,
              fallingLayers.get(scene),
              landing.getBoundingClientRect(),
              scene.seed?.(landing)?.getBoundingClientRect(),
            );
            target.old = { keyframes, options };
          }
        }
        companions.forEach((companion, index) => {
          let arrival = companion.to(landing);
          if (!arrival) traceMotionPhase(`companion-unlanded:${index}`);
          arrival?.setAttribute(
            'data-bitmap-companion',
            `${crossingKey}-${index}`,
          );
        });
        let destinationPainted = shadow?.update(landing ?? null);
        let capture = shadow;
        if (capture && destinationPainted) {
          capture.layers.forEach((layer, index) => {
            let target = builder.targets.get(layer);
            if (!target) return;
            let from = capture.sourcePainted[index];
            let to = destinationPainted[index];
            // The selected card takes its raised lighting at departure and
            // keeps it until landing on return. A full-journey blend between
            // a faint tile shadow and a raised card shadow reads as a flash.
            if (to && (opening || !from)) {
              target.old = {
                keyframes: { opacity: from ? [1, 0, 0] : 0 },
                options: from
                  ? { times: [0, 0.18, 1], ease: 'linear' }
                  : { duration: 0 },
              };
              target.new = {
                keyframes: { opacity: [0, 1, 1] },
                options: { times: [0, 0.18, 1], ease: 'linear' },
              };
            } else if (from && ((!opening && underlay) || !to)) {
              target.old = {
                keyframes: { opacity: [1, 1, 0] },
                options: { times: [0, 0.82, 1], ease: 'linear' },
              };
              target.new = {
                keyframes: { opacity: to ? [0, 0, 1] : 0 },
                options: to
                  ? { times: [0, 0.82, 1], ease: 'linear' }
                  : { duration: 0 },
              };
            }
          });
        }
        traceMotionPhase('update-end');
      },
      { duration: duration / inspectionSpeed(), ease },
    )
      .add(source, landingSelector)
      .class('boxel-card-bitmap')
      .group(false)
      .crop(true);
    if (handoff === 'late') {
      builder.old(
        { opacity: [1, 1, 0] },
        { times: [0, 0.82, 1], ease: 'linear' },
      );
      builder.new(
        { opacity: [0, 0, 1] },
        { times: [0, 0.82, 1], ease: 'linear' },
      );
    } else {
      builder.old({ opacity: [1, 0] });
      builder.new({ opacity: [0, 1] });
    }
    for (let layer of shadow.layers) {
      builder.add(layer).class('boxel-card-shadow').group(false).crop(false);
      builder.old({ opacity: [1, 0] });
      builder.new({ opacity: [0, 1] });
    }
    // Index <-> stack is one coordinated action with two measured boundaries:
    // the parent and selected child trade depth. Flatten both snapshot
    // groups so the child neither inherits the parent's scale nor its clip.
    if (underlay?.isConnected && underlay !== source) {
      builder
        .add(underlay)
        .class('boxel-stack-underlay')
        .group(false)
        // Its body/header are separate matches. Keep this empty tray's outer
        // shadow intact instead of cutting it off until the resting handoff.
        .crop(false);
      builder.old({ opacity: [1, 0] });
      builder.new({ opacity: [0, 1] });
      // The persistent card's body can change shape, but its header is the
      // same object in both scenes. Match its surface and content separately;
      // the title bitmap keeps natural-size glyphs and the icon stays square.
      // Resolve the new parts by selector because Ember may replace them.
      underlayKey = `stack-underlay-${++underlaySequence}`;
      underlay.dataset.bitmapUnderlay = underlayKey;
      if (body) {
        if (bodySize) {
          // Keep a buried body's existing layout at its last visible size.
          // Switching display:none off on return lays out the entire card
          // tree again before the first animation frame can be captured.
          body.style.setProperty(
            '--retained-body-width',
            `${bodySize.width}px`,
          );
          body.style.setProperty(
            '--retained-body-height',
            `${bodySize.height}px`,
          );
          body.dataset.retainedBodySize = '';
        }
        // Buried content is invisible. An empty frame supplies the smaller
        // snapshot destination independently of the retained body layout.
        // The bitmap fits uniformly instead of being cropped with the tray.
        bodyFrame = document.createElement('div');
        bodyFrame.dataset.bitmapBody = underlayKey;
        bodyFrame.setAttribute('aria-hidden', 'true');
        bodyFrame.style.cssText =
          'position:absolute;inset:var(--stack-item-header-height, 3rem) 0 0;pointer-events:none';
        underlay.append(bodyFrame);
        builder
          .add(
            opening ? body : bodyFrame,
            opening
              ? `[data-bitmap-body="${underlayKey}"]`
              : `[data-bitmap-underlay="${underlayKey}"] > .stack-item-content`,
          )
          .class('boxel-stack-body')
          .group(false)
          .crop(false);
        builder.old({ opacity: opening ? [1, 0] : 0 });
        builder.new({ opacity: opening ? 0 : [0, 1] });
      }
      let header = underlay.querySelector<HTMLElement>('.stack-item-header');
      if (header && opening) {
        // The buried title slides down into its strip from above, from under
        // the stationary top bar, instead of being uncovered from below as the
        // new card rises over it. Its old place fades with the parent's face.
        builder
          .add(`[data-bitmap-header-entry="${underlayKey}"]`)
          .class('boxel-stack-header')
          .group(false)
          .crop(false);
        builder.new({ transform: ['translateY(-100%)', 'translateY(0)'] });
      } else if (header) {
        builder
          .add(
            header,
            `[data-bitmap-underlay="${underlayKey}"] .stack-item-header`,
          )
          .class('boxel-stack-header')
          .group(false)
          .crop(true);
        // These are the same header parts, not different content. One face
        // avoids doubled glyphs at the midpoint of a crossfade.
        builder.old({ opacity: 0 }, { duration: 0 });
        builder.new({ opacity: 1 }, { duration: 0 });
      }
      for (let part of opening ? [] : parts) {
        builder
          .add(
            part.source,
            `[data-bitmap-underlay="${underlayKey}"] ${part.selector}`,
          )
          .class(part.layer)
          .group(false)
          .crop(false);
        builder.old({ opacity: 0 }, { duration: 0 });
        builder.new({ opacity: [1, 1], transform: part.transform });
      }
    }
    for (let scene of scenes) {
      if (scene.fade === 'morph') {
        // A persistent element whose box changes around the crossing (a
        // neighbouring stack taking the freed width): its two faces cross at
        // their natural size while the clipping frame moves. A covering crop
        // would scale the whole stack up as it widens.
        builder
          .add(scene.selector)
          .class('boxel-reflow')
          .group(false)
          .crop(true);
        builder.old({ opacity: [1, 0] });
        builder.new({ opacity: [0, 1] });
        continue;
      }
      builder
        .add(scene.selector)
        .class(
          scene.fade === 'rise' || scene.fade === 'fall'
            ? 'boxel-platter'
            : 'boxel-scene',
        )
        .group(false)
        .crop(false);
      if (scene.fade === 'rise' || scene.fade === 'fall') {
        let { keyframes, options } = platterKeyframes(scene.fade === 'rise');
        if (scene.fade === 'rise') {
          builder.old({ opacity: 0 }, { duration: 0 });
          builder.new(keyframes, options);
        } else {
          builder.old(keyframes, options);
          builder.new({ opacity: 0 }, { duration: 0 });
        }
      } else if (scene.fade === 'out') {
        builder.old(
          { opacity: [1, 0, 0] },
          { times: [0, 0.45, 1], ease: 'linear' },
        );
        builder.new({ opacity: 0 }, { duration: 0 });
      } else {
        builder.old({ opacity: 0 }, { duration: 0 });
        builder.new(
          { opacity: [0, 0, 1, 1] },
          { times: [0, 0.25, 0.8, 1], ease: 'linear' },
        );
      }
    }
    companions.forEach(({ from }, index) => {
      builder
        .add(from, `[data-bitmap-companion="${crossingKey}-${index}"]`)
        .class('boxel-companion')
        .group(false)
        .crop(false);
      builder.old({ opacity: [1, 0] });
      builder.new({ opacity: [0, 1] });
    });
    // View Transition layers are above DOM z-index. Capture persistent chrome
    // as its own stationary face so the crossing cannot cover the toolbar.
    builder
      .add('.submode-layout-top-bar, .ai-assistant-resizable-panel')
      .class('boxel-stationary-chrome')
      .group(false)
      .crop(false);
    if (chrome === 'crossfade') {
      builder.old(
        { opacity: [1, 0, 0] },
        { times: [0, 0.4, 1], ease: 'linear' },
      );
      builder.new(
        { opacity: [0, 0, 1] },
        { times: [0, 0.5, 1], ease: 'linear' },
      );
    } else {
      builder.old({ opacity: 0 }, { duration: 0 });
      builder.new({ opacity: 1 }, { duration: 0 });
    }
    traceMotionPhase('capture-prepared');
    // Corner/edge affordances are a separate foreground plane. In particular,
    // the closed search dock must not disappear behind an enlarging card.
    builder
      .add('.search-sheet.closed, .add-card-to-neighbor-stack, .chat-btn')
      .class('boxel-edge-chrome')
      .group(false)
      .crop(false);
    builder.old({ opacity: 0 }, { duration: 0 });
    builder.new({ opacity: 1 }, { duration: 0 });
    // motion-dom 13's declaration omits the controls delivered by then();
    // its runtime resolves GroupAnimation, whose finished promise owns cleanup.
    let run = await (builder as unknown as PromiseLike<{
      finished: Promise<void>;
      complete: () => void;
    }>);
    onReady?.(() => run.complete());
    traceMotionPhase('playback-ready');
    await playbackSettled(run, duration / inspectionSpeed());
  } catch (error) {
    // An unavailable capture must never prevent the requested navigation.
    if (!updated) await update();
    else throw error;
  } finally {
    traceMotionPhase('finished');
    releaseFinishedViewAnimations();
    bodyFrame?.remove();
    shadow?.release();
    if (underlayKey && underlay?.dataset.bitmapUnderlay === underlayKey) {
      delete underlay.dataset.bitmapUnderlay;
    }
    if (underlayKey)
      document
        .querySelector(`[data-bitmap-header-entry="${underlayKey}"]`)
        ?.removeAttribute('data-bitmap-header-entry');
    if (landing?.getAttribute('data-bitmap-landing') === crossingKey)
      landing.removeAttribute('data-bitmap-landing');
    for (let companion of document.querySelectorAll(
      `[data-bitmap-companion^="${crossingKey}-"]`,
    ))
      companion.removeAttribute('data-bitmap-companion');
  }
}
