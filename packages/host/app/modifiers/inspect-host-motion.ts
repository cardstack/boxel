import { modifier } from 'ember-modifier';

import { inspectionSpeed } from '@cardstack/host/lib/motion-timing';

import type { ChoreoContext } from 'glimmer-motion';

/* eslint-disable @cardstack/boxel/no-raf-for-state -- Opt-in painted-frame diagnostics; never updates Ember state or drives playback. */

// Opt-in instrumentation only. Normal playback has no observer or frame loop.
// ?motionInspect=1&motionSpeed=0.2 records slow-motion values for inspection.
// Read the request at module startup: route serialization can remove these
// diagnostic query parameters before the motion region mounts or remounts.
const inspectionParams = new URLSearchParams(location.search);

interface LayerFrame {
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
  old: number;
  new: number;
  clock: number;
}

// Per layer: frames where geometry reverses against the layer's overall
// direction (a snap back), frames that move several times their neighbours
// (a spike), and face-opacity jumps. Plus frame gaps over 24 ms.
function summarizeJank(layers: Record<string, LayerFrame[]>, frames: number[]) {
  let keys = ['x', 'y', 'width', 'height'] as const;
  let byLayer: Record<string, string[]> = {};
  for (let [name, rows] of Object.entries(layers)) {
    let notes: string[] = [];
    for (let key of keys) {
      let direction = Math.sign(rows.at(-1)![key] - rows[0]![key]);
      for (let i = 1; i < rows.length; i++) {
        let step = rows[i]![key] - rows[i - 1]![key];
        let before = i > 1 ? rows[i - 1]![key] - rows[i - 2]![key] : step;
        if (
          Math.abs(step) > 0.75 &&
          direction &&
          Math.sign(step) === -direction
        )
          notes.push(
            `${key} reverses ${step.toFixed(1)} at ${rows[i]!.time}ms`,
          );
        else if (Math.abs(step) > 3 * Math.abs(before) + 12)
          notes.push(`${key} spikes ${step.toFixed(1)} at ${rows[i]!.time}ms`);
      }
    }
    for (let face of ['old', 'new'] as const)
      for (let i = 1; i < rows.length; i++) {
        let step = rows[i]![face] - rows[i - 1]![face];
        if (Math.abs(step) > 0.3)
          notes.push(
            `${face} face jumps ${step.toFixed(2)} at ${rows[i]!.time}ms`,
          );
      }
    if (notes.length) byLayer[name] = notes.slice(0, 12);
  }
  let elapsed = 0;
  let gaps: string[] = [];
  for (let gap of frames) {
    elapsed += gap;
    if (gap > 24)
      gaps.push(`${Math.round(gap)}ms frame ending ${Math.round(elapsed)}ms`);
  }
  return { layers: byLayer, gaps };
}
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
    // Every painted frame of every view-transition layer: geometry, face
    // opacity and its geometry animation's clock. A one-frame snap back is
    // invisible at the 45 ms geometry sampling below.
    let layers: Record<string, LayerFrame[]> = {};
    let track = (time: number) => {
      let root = document.documentElement;
      for (let animation of document.getAnimations()) {
        let effect = animation.effect as KeyframeEffect | null;
        let pseudo = effect?.pseudoElement;
        let name = pseudo?.match(/^::view-transition-group\((.*)\)$/)?.[1];
        if (!name || layers[name]?.at(-1)?.time === time) continue;
        let group = getComputedStyle(root, pseudo);
        let matrix = new DOMMatrixReadOnly(group.transform);
        (layers[name] ??= []).push({
          time,
          x: round(matrix.e),
          y: round(matrix.f),
          width: round(parseFloat(group.width)),
          height: round(parseFloat(group.height)),
          old: round(
            Number(
              getComputedStyle(root, `::view-transition-old(${name})`).opacity,
            ),
          ),
          new: round(
            Number(
              getComputedStyle(root, `::view-transition-new(${name})`).opacity,
            ),
          ),
          clock: round(Number(animation.currentTime ?? 0)),
        });
      }
    };
    let sample = () => {
      let now = performance.now();
      frames.push(round(now - last));
      last = now;
      if (detailed) track(round(now - start));
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
          layers,
          jank: detailed ? summarizeJank(layers, frames) : undefined,
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
