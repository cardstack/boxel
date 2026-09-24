import { array } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Choreo, type Sprite, type PerformCommand } from 'glimmer-motion';

import MotionTiming, {
  motionEase as ease,
  motionDurations,
} from '@cardstack/host/lib/motion-timing';
import { liftIn, liftOut } from '@cardstack/host/lib/motion-transform';
import hostMotionBudget from '@cardstack/host/modifiers/host-motion-budget';
import inspectHostMotion from '@cardstack/host/modifiers/inspect-host-motion';
import type HostMotionService from '@cardstack/host/services/host-motion';

import HeaderMotion from './header-motion';
import StackReflow from './stack-reflow';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    // Tests can exercise real motion without slowing every host test down.
    duration?: number;
    budgeted?: boolean;
    instant?: boolean;
    portalActive?: boolean;
    onPerform?: (command: PerformCommand) => void;
  };
  Blocks: { default: [] };
}

const restingOpacity = (sprite: Sprite) => [
  Number(getComputedStyle(sprite.element).opacity),
  sprite.element.hasAttribute('data-stack-covered') ? 0 : 1,
];

// Own both stacks and their portaled headers. This region survives the last
// card's exit and measures the header handoff in the same pass as expansion.
export default class StackMotion extends Component<Signature> {
  @service declare private hostMotion: HostMotionService;
  private timing = new MotionTiming(this);

  private get armed() {
    return (
      !this.args.instant &&
      ((this.args.duration !== undefined && !this.args.budgeted) ||
        this.hostMotion.isArmed('stack'))
    );
  }

  private get primaryId() {
    return this.args.duration !== undefined && !this.args.budgeted
      ? undefined
      : (this.hostMotion.primaryId ?? '__no-primary__');
  }

  private get headerDuration() {
    return this.args.duration !== undefined || this.hostMotion.headerActive
      ? this.duration
      : 0;
  }

  private get duration() {
    return this.args.instant ? 0 : this.timing.duration(this.args.duration);
  }

  private get exitDuration() {
    return this.args.instant
      ? 0
      : this.timing.duration(this.args.duration, motionDurations.exit);
  }

  <template>
    <Choreo
      class='host-stack-motion'
      @onPerform={{@onPerform}}
      ...attributes
      as |c|
    >
      <div
        hidden
        {{inspectHostMotion c}}
        {{hostMotionBudget this.hostMotion c 'stack'}}
      ></div>
      {{yield}}
      {{#if this.armed}}
        <c.Parallel>
          <HeaderMotion
            @context={{c}}
            @duration={{this.headerDuration}}
            @primaryId={{this.primaryId}}
          />
          <c.Tween
            @of={{c.inserted 'opening-card'}}
            @transform={{liftIn}}
            @opacity={{array 0 1}}
            @duration={{this.duration}}
            @ease={{ease}}
          />
          {{#unless @portalActive}}
            <c.Tween
              @of={{c.kept 'workspace-cards'}}
              @transform='none'
              @opacity={{1}}
              @duration={{0}}
            />
            <c.Tween
              @of={{c.kept 'workspace-wallpaper'}}
              @clipPath='none'
              @opacity={{1}}
              @duration={{0}}
            />
            <c.Tween
              @of={{array
                (c.removed 'opening-card')
                (c.removed 'stack-card')
                (c.removed 'dock-card')
              }}
              @opacity={{0}}
              @transform={{liftOut}}
              @duration={{this.exitDuration}}
              @ease={{ease}}
            />
          {{/unless}}
          {{! Continue interrupted opacity; StackReflow owns position only.
        Live text is never stretched with independent scaleX/scaleY. }}
          <c.Tween
            @of={{array
              (c.kept 'opening-card')
              (c.kept 'stack-card')
              (c.kept 'dock-card')
              (c.kept 'portal-card')
            }}
            @opacity={{restingOpacity}}
            @duration={{this.duration}}
            @ease={{ease}}
          />
          <StackReflow
            @duration={{this.duration}}
            @primaryId={{this.primaryId}}
          />
        </c.Parallel>
      {{/if}}
    </Choreo>
    <style scoped>
      .host-stack-motion {
        --choreo-raised-z-index: var(--host-card-motion-z-index, 150);
      }
      .host-stack-motion > :global([data-choreo-orphans]) {
        z-index: var(--host-stack-exit-z-index, 100);
      }
    </style>
  </template>
}
