import {
  StepComponent,
  type ChoreoContext,
  type PropSource,
  type Query,
  type TimelineNode,
} from 'glimmer-motion';

import { motionEase } from '@cardstack/host/lib/motion-timing';
import {
  paintedTranslation,
  surfaceTransform,
} from '@cardstack/host/lib/motion-transform';

const contentTransform: PropSource = (sprite, changeset) => {
  let parentId = sprite.id?.replace(/:(icon|title|actions)$/, '');
  let parent = changeset.sprites({ id: parentId })[0];
  let a = sprite.initial ?? sprite.counterpart?.initial;
  let b = sprite.final;
  let pa = parent?.initial ?? parent?.counterpart?.initial;
  let pb = parent?.final;
  if (!a || !b || !pa || !pb) return 'none';
  let from = a.substance ?? a.page;
  let to = b.substance ?? b.page;
  let current = paintedTranslation(sprite);
  let zoom = changeset.measureZoom || 1;
  return [
    `translate(${current.x + (from.x - pa.page.x - to.x + pb.page.x) / zoom}px, ${current.y + (from.y - pa.page.y - to.y + pb.page.y) / zoom}px)`,
    'none',
  ];
};

const surfaceRadius: PropSource = (sprite) => {
  let source = sprite.counterpart?.element ?? sprite.element;
  let from = JSON.parse(
    (source as HTMLElement).dataset.motionRadii ?? '[0,0]',
  ) as number[];
  let to = JSON.parse(
    (sprite.element as HTMLElement).dataset.motionRadii ?? '[0,0]',
  ) as number[];
  let radius = (r: number[]) => `${r[0]}px ${r[0]}px ${r[1]}px ${r[1]}px`;
  let style = getComputedStyle(source);
  // Keep four components at both ends: a uniform computed radius collapses to
  // one value, which Motion cannot interpolate with a four-corner shorthand.
  let current = style.borderTopLeftRadius
    ? `${style.borderTopLeftRadius} ${style.borderTopRightRadius} ${style.borderBottomRightRadius} ${style.borderBottomLeftRadius}`
    : radius(from);
  return [current, radius(to)];
};

export default class HeaderMotion extends StepComponent<{
  context: ChoreoContext;
  duration: number;
  primaryId?: string;
}> {
  node(): TimelineNode {
    let { context, duration, primaryId: id } = this.args;
    let header = id ? `${id}:header` : undefined;
    let of: Query[] = [{ ...context.received('stack-header'), id: header }];
    let surfaces: Query[] = [
      {
        ...context.received('header-surface'),
        id: header ? `${header}:surface` : undefined,
      },
    ];
    let content: Query[] = header
      ? ['icon', 'title', 'actions'].map((part) => ({
          ...context.received('header-content'),
          id: `${header}:${part}`,
        }))
      : [context.received('header-content')];
    let shadows: Query[] = [
      {
        ...context.received('header-shadow'),
        id: header ? `${header}:shadow` : undefined,
      },
    ];
    let run = context.run;
    if (run && !run.isDone()) {
      for (let cue of run.cues) {
        let { id, role } = cue.sprite;
        if (!id) continue;
        if (header && id !== header && !id.startsWith(`${header}:`)) continue;
        let list =
          role === 'stack-header'
            ? of
            : role === 'header-surface'
              ? surfaces
              : role === 'header-shadow'
                ? shadows
                : role === 'header-content'
                  ? content
                  : undefined;
        list?.push({ id, type: 'kept' });
      }
    }
    return {
      kind: 'parallel',
      children: [
        {
          kind: 'move',
          of,
          size: false,
          path: 'M 0 0 L 1 1',
          swap: 'none',
          ms: duration * 1000,
          ease: motionEase,
        },
        {
          kind: 'tween',
          of: surfaces,
          props: { transform: surfaceTransform, borderRadius: surfaceRadius },
          ms: duration * 1000,
          ease: motionEase,
        },
        {
          kind: 'tween',
          of: content,
          props: { transform: contentTransform },
          ms: duration * 1000,
          ease: motionEase,
        },
        {
          kind: 'tween',
          of: shadows,
          props: { transform: surfaceTransform },
          ms: duration * 1000,
          ease: motionEase,
        },
        { kind: 'raise', of },
        {
          kind: 'hold',
          fill: true,
          of: { ...context.counterpart('stack-header'), id: header },
          props: { visibility: 'hidden', pointerEvents: 'none' },
        },
      ],
    };
  }
}
