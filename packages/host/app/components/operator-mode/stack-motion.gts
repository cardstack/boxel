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
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

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
  @service declare private operatorModeStateService: OperatorModeStateService;
  private timing = new MotionTiming(this);

  private get armed() {
    return (
      !this.args.instant &&
      ((this.args.duration !== undefined && !this.args.budgeted) ||
        this.hostMotion.isArmed('stack'))
    );
  }

  // Whether a render pass could play anything in this region. The workspace
  // portal and a non-bitmap dock opening score their own steps while ordinary
  // stack motion stands down; skipping their passes would strand them.
  private get measuring() {
    return (
      this.armed ||
      !!this.args.portalActive ||
      this.hostMotion.workspaceActive ||
      this.operatorModeStateService.state.stacks.some((stack) =>
        stack.some(
          (item) => item.openingOrigin && !item.openingOrigin.bitmapKey,
        ),
      )
    );
  }

  // A scene without a primary card (a whole stack closing) reflows every
  // kept card; otherwise only the primary spends the geometry budget.
  private get primaryId() {
    return this.args.duration !== undefined && !this.args.budgeted
      ? undefined
      : this.hostMotion.primaryId;
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
      @armed={{this.measuring}}
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
