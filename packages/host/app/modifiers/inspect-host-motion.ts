import { modifier } from 'ember-modifier';

import { inspectionSpeed } from '@cardstack/host/lib/motion-timing';

import type { ChoreoContext } from 'glimmer-motion';

/* eslint-disable @cardstack/boxel/no-raf-for-state -- Opt-in painted-frame diagnostics; never updates Ember state or drives playback. */

// Opt-in instrumentation only. Normal playback has no observer or frame loop.
// ?motionInspect=1&motionSpeed=0.2 records slow-motion values for inspection.
// Read the request at module startup: route serialization can remove these
// diagnostic query parameters before the motion region mounts or remounts.
const inspectionParams = new URLSearchParams(location.search);
export default modifier((anchor: HTMLElement, [context]: [ChoreoContext]) => {
  let detailed = inspectionParams.has('motionInspect');
  if (!detailed && !inspectionParams.has('motionTrace')) return;
  let root = anchor.closest<HTMLElement>('[data-choreo]')!;
  let output = document.createElement('script');
  output.type = 'application/json';
  output.id = 'host-motion-inspection';
  document.body.append(output);
  let records: unknown[] = [];
  let identities = new WeakMap<Element, number>();
  let nextIdentity = 0;
  let frame = 0;
  let observer: PerformanceObserver | undefined;
  let frameObserver: PerformanceObserver | undefined;
  let round = (value: number) => Math.round(value * 100) / 100;
  let pose = () =>
    Array.from(
      root.querySelectorAll<HTMLElement>(
        '.workspace-scene, .workspace-wallpaper, .stacks, .item, .search-sheet, .header-motion-parts, .header-motion-surface, .header-motion-parts .card-type-display-name',
      ),
    ).map((element) => {
      if (!identities.has(element)) identities.set(element, ++nextIdentity);
      let box = element.getBoundingClientRect();
      let style = getComputedStyle(element);
      return {
        element: element.className,
        identity: identities.get(element),
        x: round(box.x),
        y: round(box.y),
        width: round(box.width),
        height: round(box.height),
        layoutWidth: element.offsetWidth,
        layoutHeight: element.offsetHeight,
        opacity: style.opacity,
        transform: style.transform,
        radius: style.borderRadius,
        clip: style.clipPath,
        layer: style.zIndex,
        visibility: style.visibility,
      };
    });
  let record = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    frameObserver?.disconnect();
    let start = performance.now();
    let last = start;
    let frames: number[] = [];
    let tasks: { start: number; duration: number }[] = [];
    let longFrames: unknown[] = [];
    let samples: {
      time: number;
      pose: ReturnType<typeof pose>;
      cues: unknown;
      native: unknown;
    }[] = [];
    let initial = detailed ? JSON.stringify(pose()) : undefined;
    let firstChange: number | undefined;
    let speed = inspectionSpeed();
    let span = Math.max(1400, 900 / Math.max(0.1, speed));
    let label =
      event.target.closest('button')?.getAttribute('aria-label') ||
      event.target.textContent?.trim().slice(0, 80) ||
      event.type;
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        for (let entry of list.getEntries())
          tasks.push({
            start: round(entry.startTime - start),
            duration: round(entry.duration),
          });
      });
      observer.observe({ type: 'longtask' });
    }
    if (
      PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
    ) {
      frameObserver = new PerformanceObserver((list) => {
        longFrames.push(...list.getEntries().map((entry) => entry.toJSON()));
      });
      frameObserver.observe({ type: 'long-animation-frame' });
    }
    let sample = () => {
      let now = performance.now();
      frames.push(round(now - last));
      last = now;
      let current = detailed ? pose() : [];
      if (
        detailed &&
        firstChange === undefined &&
        JSON.stringify(current) !== initial
      )
        firstChange = round(now - start);
      // Limit retained data; sampling overhead is reported separately from FPS.
      if (
        detailed &&
        (!samples.length || now - start - samples.at(-1)!.time >= 45)
      )
        samples.push({
          time: round(now - start),
          pose: current,
          native: document.getAnimations().map((animation) => {
            let effect = animation.effect as KeyframeEffect | null;
            let target = effect?.target;
            let pseudo = effect?.pseudoElement;
            let bitmapStyle = pseudo?.startsWith('::view-transition-group(')
              ? getComputedStyle(document.documentElement, pseudo)
              : undefined;
            return {
              target: target instanceof Element ? target.className : null,
              pseudo,
              time: animation.currentTime,
              duration: effect?.getComputedTiming().duration,
              bitmap: bitmapStyle
                ? {
                    width: bitmapStyle.width,
                    height: bitmapStyle.height,
                    transform: bitmapStyle.transform,
                    radius: bitmapStyle.borderRadius,
                  }
                : undefined,
              properties: [
                ...new Set(
                  effect
                    ?.getKeyframes()
                    .flatMap((keyframe) =>
                      Object.keys(keyframe).filter(
                        (key) =>
                          ![
                            'offset',
                            'computedOffset',
                            'easing',
                            'composite',
                          ].includes(key),
                      ),
                    ) ?? [],
                ),
              ],
            };
          }),
          cues: context.run?.cues.map((cue) => ({
            kind: cue.kind,
            role: cue.sprite.role,
            id: cue.sprite.id,
            type: cue.sprite.type,
            target: cue.target,
            start: cue.start,
            duration: cue.duration,
          })),
        });
      if (now - start < span) frame = requestAnimationFrame(sample);
      else {
        observer?.disconnect();
        frameObserver?.disconnect();
        records.push({
          label,
          viewport: { width: innerWidth, height: innerHeight },
          speed,
          firstChange,
          elapsed: round(now - start),
          frames,
          tasks,
          longFrames,
          // Lightweight trace mode never reads layout or enumerates animation
          // keyframes. Keep it separate from deliberate slow-motion inspection.
          mode: detailed ? 'geometry-inspection' : 'performance-trace',
          phases: performance
            .getEntriesByType('mark')
            .filter(
              (entry) =>
                entry.name.startsWith('boxel-motion:') &&
                entry.startTime >= start,
            )
            .map((entry) => ({
              phase: entry.name.slice('boxel-motion:'.length),
              time: round(entry.startTime - start),
            })),
          samples,
        });
        records = records.slice(-10);
        output.textContent = JSON.stringify(records);
      }
    };
    frame = requestAnimationFrame(sample);
  };
  document.addEventListener('click', record, true);
  return () => {
    document.removeEventListener('click', record, true);
    cancelAnimationFrame(frame);
    observer?.disconnect();
    frameObserver?.disconnect();
    output.remove();
  };
});
