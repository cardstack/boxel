import { array } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';
import { Choreo, motion } from 'glimmer-motion';

import { eq } from '@cardstack/boxel-ui/helpers';

import MotionTiming, {
  motionEase as ease,
  motionDurations,
} from '@cardstack/host/lib/motion-timing';

import { sheetSurfaceTransform } from '@cardstack/host/lib/motion-transform';
import hostMotionBudget from '@cardstack/host/modifiers/host-motion-budget';
import type HostMotionService from '@cardstack/host/services/host-motion';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    size: 'closed' | 'prompt' | 'results';
    duration?: number;
    instant?: boolean;
  };
  Blocks: { default: [] };
}

export default class SearchSheetMotion extends Component<Signature> {
  @service declare private hostMotion: HostMotionService;
  private get armed() {
    return (
      this.args.instant ||
      this.args.duration !== undefined ||
      this.hostMotion.isArmed('sheet')
    );
  }
  private timing = new MotionTiming(this);
  private element?: HTMLElement;
  private lastPosition?: string;

  private capture = modifier((element: HTMLElement) => {
    this.element = element;
    return () => (this.element = undefined);
  });

  private get duration() {
    return this.args.instant
      ? 0
      : this.timing.duration(this.args.duration, motionDurations.sheet);
  }

  // The final timeline cue also runs when duration is zero. Cancelled runs
  // discard their pending cues, so only the current layout repositions menus.
  private repositionDropdowns = () => {
    let sheet = this.element?.querySelector('.search-sheet');
    if (!sheet) return;
    let { x, y, width, height } = sheet.getBoundingClientRect();
    let position = `${this.args.size}:${x}:${y}:${width}:${height}`;
    if (position === this.lastPosition) return;
    this.lastPosition = position;
    window.dispatchEvent(new Event('resize'));
  };

  <template>
    <Choreo
      class='search-sheet-motion'
      @armed={{this.armed}}
      @onPerform={{this.repositionDropdowns}}
      {{this.capture}}
      as |c|
    >
      <div hidden {{hostMotionBudget this.hostMotion c 'sheet'}}></div>
      <div
        class='search-sheet {{@size}}'
        {{motion role='search-sheet'}}
        ...attributes
      >
        <div
          class='sheet-surface'
          aria-hidden='true'
          {{motion role='search-sheet-surface'}}
        ></div>
        {{yield}}
      </div>
      {{#if this.armed}}
        <c.Sequence>
          <c.Parallel>
            <c.Tween
              @of={{c.kept 'search-sheet-surface'}}
              @transform={{sheetSurfaceTransform}}
              @duration={{this.duration}}
              @ease={{ease}}
            />
            <c.Move
              @of={{c.kept 'search-sheet-header'}}
              @size={{false}}
              @path='M 0 0 L 1 1'
              @duration={{this.duration}}
              @ease={{ease}}
            />
            <c.Tween
              @of={{array
                (c.inserted 'search-sheet-content')
                (c.inserted 'search-sheet-header')
              }}
              @opacity={{array 0 1}}
              @duration={{this.duration}}
              @ease={{ease}}
            />
            <c.Tween
              @of={{array
                (c.kept 'search-sheet-content')
                (c.kept 'search-sheet-header')
              }}
              @opacity={{1}}
              @duration={{this.duration}}
              @ease={{ease}}
            />
            <c.Tween
              @of={{array
                (c.inserted 'search-sheet-footer')
                (c.kept 'search-sheet-footer')
              }}
              @opacity={{if (eq @size 'results') 1 0}}
              @duration={{this.duration}}
              @ease={{ease}}
            />
          </c.Parallel>
          <c.Perform @action='reposition-dropdowns' />
        </c.Sequence>
      {{/if}}
    </Choreo>
    <style scoped>
      :global(:root) {
        --search-sheet-closed-height: calc(
          var(--operator-mode-bottom-bar-item-height) +
            var(--operator-mode-spacing)
        );
        --search-sheet-closed-width: var(--container-button-size);
        --search-sheet-prompt-height: 10.45rem;
      }

      .search-sheet {
        --search-sheet-left-offset: calc(var(--operator-mode-spacing));
        --search-sheet-right-offset: calc(
          var(--container-button-size) + 2 * var(--operator-mode-spacing)
        );
        background-color: transparent;
        /* Top is defined by the destination size, independently of the
           animated height, so the two tracks keep the bottom anchored. */
        top: calc(100% - var(--search-sheet-height));
        height: var(--search-sheet-height);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        justify-content: stretch;
        left: var(--search-sheet-left-offset);
        width: calc(
          100% - var(--search-sheet-left-offset) -
            var(--search-sheet-right-offset)
        );
        position: absolute;
        z-index: var(--host-search-sheet-z-index);
      }
      .search-sheet:not(.closed) {
        overflow: hidden;
        border-top-right-radius: var(--boxel-border-radius-xxl);
        border-top-left-radius: var(--boxel-border-radius-xxl);
        border-bottom-right-radius: 0;
        border-bottom-left-radius: 0;
      }
      .sheet-surface {
        position: absolute;
        inset: 0;
        transform-origin: 0 0;
        pointer-events: none;
        z-index: -1;
        background: var(--boxel-light);
        border-radius: inherit;
        box-shadow: var(--boxel-deep-box-shadow);
      }
      .closed .sheet-surface {
        background: transparent;
        box-shadow: none;
      }
      .search-sheet {
        isolation: isolate;
      }
      .closed {
        --search-sheet-height: var(--search-sheet-closed-height);
        width: var(--search-sheet-closed-width);
      }

      .prompt {
        --search-sheet-height: var(--search-sheet-prompt-height);
      }

      .results {
        --search-sheet-height: calc(100% - var(--stack-padding-top));
      }

      .search-sheet-motion {
        position: absolute;
        inset: 0;
        transform-origin: 0 0;
        pointer-events: none;
        z-index: var(--host-search-sheet-z-index);
      }
    </style>
  </template>
}
