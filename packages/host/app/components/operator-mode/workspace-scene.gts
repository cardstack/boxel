import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';
import {
  motion,
  StepComponent,
  type Sprite,
  type TimelineNode,
} from 'glimmer-motion';

import MotionTiming, {
  motionDurations,
  motionEase,
} from '@cardstack/host/lib/motion-timing';
import type { WorkspacePortal } from '@cardstack/host/lib/workspace-open-origin';
import type HostMotionService from '@cardstack/host/services/host-motion';

type PropTarget = string | number | (string | number)[];

function normalizedClip(value: string) {
  let [inset, radius] = value
    .replace('inset(', '')
    .replace(')', '')
    .split('round');
  let values = inset!.trim().split(/\s+/).map(parseFloat);
  let [top = 0, right = top, bottom = top, left = right] = values;
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${parseFloat(radius ?? '0')}px)`;
}

class PortalSteps extends StepComponent<{
  portal: WorkspacePortal;
  duration: number;
}> {
  private token?: number;
  private startedAt = 0;
  private get opening() {
    return this.args.portal.direction === 'opening';
  }

  private clip = (sprite: Sprite): PropTarget => {
    let style = getComputedStyle(sprite.element);
    let origin = style.getPropertyValue('--portal-origin-clip').trim();
    let full = 'inset(0px 0px 0px 0px round 0px)';
    let destination = this.opening || this.args.portal.fade ? full : origin;
    return [
      style.clipPath === 'none'
        ? this.opening
          ? origin
          : full
        : normalizedClip(style.clipPath),
      destination,
    ];
  };

  private wallpaperOpacity = (sprite: Sprite): PropTarget => [
    Number(getComputedStyle(sprite.element).opacity),
    this.args.portal.fade && !this.opening ? 0 : 1,
  ];

  private cardOpacity = (sprite: Sprite): PropTarget => {
    let destination = this.opening ? 1 : 0;
    return [Number(getComputedStyle(sprite.element).opacity), destination];
  };

  node(): TimelineNode {
    let duration = this.args.duration * 1000;
    if (this.token !== this.args.portal.token) {
      this.token = this.args.portal.token;
      this.startedAt = performance.now();
    }
    let elapsed = performance.now() - this.startedAt;
    // Explicit windows preserve ordering without driving an inherited CSS
    // variable every frame. Late content cannot extend the action's deadline.
    let window = (start: number, end: number) => ({
      delay: Math.max(0, duration * start - elapsed),
      ms: Math.max(0, duration * end - Math.max(elapsed, duration * start)),
    });
    return {
      kind: 'sequence',
      children: [
        {
          kind: 'parallel',
          children: [
            {
              kind: 'tween',
              of: { role: 'workspace-wallpaper' },
              props: { clipPath: this.clip, opacity: this.wallpaperOpacity },
              ease: motionEase,
              ...window(this.opening ? 0 : 0.4, this.opening ? 0.55 : 1),
            },
            {
              kind: 'tween',
              of: { role: 'workspace-cards' },
              props: {
                opacity: this.cardOpacity,
              },
              ease: motionEase,
              ...window(this.opening ? 0.55 : 0, this.opening ? 1 : 0.4),
            },
          ],
        },
        {
          kind: 'perform',
          action: 'workspace-portal-complete',
          payload: this.args.portal.token,
        },
      ],
    };
  }
}

interface Signature {
  Element: HTMLDivElement;
  Args: { portal?: WorkspacePortal; concealed?: boolean; duration?: number };
  Blocks: { default: [] };
}

export default class WorkspaceScene extends Component<Signature> {
  @service declare private hostMotion: HostMotionService;
  private previousPortal?: number;
  private timing = new MotionTiming(this);
  private get duration() {
    return this.hostMotion.dragging
      ? 0
      : this.timing.duration(this.args.duration, motionDurations.workspace);
  }
  private measure = modifier(
    (element: HTMLElement, [portal]: [WorkspacePortal | undefined]) => {
      if (!portal) {
        this.previousPortal = undefined;
        return;
      }
      let first = this.previousPortal === undefined;
      this.previousPortal = portal.token;
      let measure = () => {
        let box = element.getBoundingClientRect();
        let scaleX = box.width / element.offsetWidth || 1;
        let scaleY = box.height / element.offsetHeight || 1;
        let { origin } = portal;
        let left = Math.max(0, (origin.x - box.x) / scaleX);
        let top = Math.max(0, (origin.y - box.y) / scaleY);
        let right = Math.max(
          0,
          element.offsetWidth - left - origin.width / scaleX,
        );
        let bottom = Math.max(
          0,
          element.offsetHeight - top - origin.height / scaleY,
        );
        element.style.setProperty(
          '--portal-origin-clip',
          `inset(${top}px ${right}px ${bottom}px ${left}px round ${origin.radius}px)`,
        );
      };
      measure();
      if (first) {
        let wallpaper = element.querySelector<HTMLElement>(
          '.workspace-wallpaper',
        );
        let cards = element.querySelector<HTMLElement>('.stacks');
        let opening = portal.direction === 'opening';
        if (wallpaper) {
          wallpaper.style.opacity = '1';
          wallpaper.style.clipPath = opening
            ? element.style.getPropertyValue('--portal-origin-clip')
            : 'inset(0px 0px 0px 0px round 0px)';
        }
        if (cards) {
          cards.style.opacity = opening ? '0' : '1';
          cards.style.transform = 'none';
        }
      }
      let observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    },
  );

  <template>
    <div
      class='workspace-scene
        {{if @portal "portal"}}
        {{if @concealed "concealed"}}'
      aria-hidden={{if @concealed 'true'}}
      inert={{@concealed}}
      data-portal-direction={{@portal.direction}}
      {{motion role='workspace-scene'}}
      {{this.measure @portal}}
      ...attributes
    >
      {{yield}}
      {{#if @portal}}
        <PortalSteps @portal={{@portal}} @duration={{this.duration}} />
      {{/if}}
    </div>
    <style scoped>
      .portal {
        z-index: 1;
      }
      .portal[data-portal-direction='opening'] :deep(.stacks) {
        opacity: 0;
      }
      .workspace-scene:not(.portal) :deep(.workspace-wallpaper) {
        clip-path: none;
      }
      .concealed {
        visibility: hidden;
        pointer-events: none;
      }
    </style>
  </template>
}
