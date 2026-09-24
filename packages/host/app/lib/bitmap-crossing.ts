import { animateView, type ViewTransitionOptions } from 'glimmer-motion';

import { prepareBitmapShadow } from './bitmap-shadow';
import { inspectionSpeed, motionDurations, motionEase } from './motion-timing';
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

export function supportsBitmapCrossing() {
  return (
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// The browser captures both faces as raster layers. Their shared frame morphs,
// while object-fit: cover keeps each bitmap proportional and crops the excess.
// No live card tree is resized or independently stretched on either axis.
export async function crossfadeCardBitmap(
  source: HTMLElement,
  destination: string,
  update: () => void | Promise<void>,
  duration = motionDurations.crossing,
  ease: ViewTransitionOptions['ease'] = motionEase,
  onReady?: (finish: () => void) => void,
  underlay?: HTMLElement,
) {
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
    let bodySize =
      body && opening
        ? { width: body.offsetWidth, height: body.offsetHeight }
        : undefined;
    let parts = headerParts(underlay);
    shadow = prepareBitmapShadow(source);
    // Keep document-scoped capture: Chromium 153 can abort element-scoped
    // capture when Ember replaces the named source node during the update.
    let builder = animateView(
      async () => {
        updated = true;
        traceMotionPhase('update-start');
        await update();
        traceMotionPhase('update-rendered');
        for (let part of parts) {
          let target = underlay?.querySelector<HTMLElement>(part.selector);
          if (!target) continue;
          let to = part.size(target);
          // The builder consumes these keyframes after destination capture.
          // Only the raster transform animates; live font/layout is final.
          part.transform[0] = `scale(${to > 0 ? part.from / to : 1})`;
        }
        traceMotionPhase('header-measured');
        let destinationPainted = shadow?.update(
          document.querySelector<HTMLElement>(destination),
        );
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
      .add(source, destination)
      .class('boxel-card-bitmap')
      .group(false)
      .crop(true);
    builder.old({ opacity: [1, 0] });
    builder.new({ opacity: [0, 1] });
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
      if (header) {
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
      for (let part of parts) {
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
    // View Transition layers are above DOM z-index. Capture persistent chrome
    // as its own stationary face so the crossing cannot cover the toolbar.
    builder
      .add('.submode-layout-top-bar, .ai-assistant-resizable-panel')
      .class('boxel-stationary-chrome')
      .group(false)
      .crop(false);
    builder.old({ opacity: 0 }, { duration: 0 });
    builder.new({ opacity: 1 }, { duration: 0 });
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
    await run.finished;
  } catch (error) {
    // An unavailable capture must never prevent the requested navigation.
    if (!updated) await update();
    else throw error;
  } finally {
    traceMotionPhase('finished');
    bodyFrame?.remove();
    shadow?.release();
    if (underlayKey && underlay?.dataset.bitmapUnderlay === underlayKey) {
      delete underlay.dataset.bitmapUnderlay;
    }
  }
}
