import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';

const tabs = ['Forge', 'Reel', 'Ore'] as const;
const pill = { bounce: 0.22, type: 'spring', visualDuration: 0.4 } as const;

type Tab = (typeof tabs)[number];

export class SharedTabs extends Component {
  @tracked selected: Tab = 'Reel';

  select = (tab: Tab) => {
    this.selected = tab;
  };

  <template>
    <LayoutGroup>
      <div class='ex'>
        <div class='tabs'>
          <div class='tab-row'>
            {{#each tabs as |tab|}}
              <button
                type='button'
                class={{if (isOn tab this.selected) 'tab is-on' 'tab'}}
                {{on 'click' (fn this.select tab)}}
              >
                {{#if (isOn tab this.selected)}}
                  <span
                    class='tab-line'
                    {{motion
                      layoutId='tab-pill'
                      transition=(tuneMotion 'tabs' pill 'pill')
                    }}
                  ></span>
                {{/if}}
                {{tab}}
              </button>
            {{/each}}
          </div>
          <p class='tab-hint'>
            The highlight is one node. It moves to
            <b>{{this.selected}}</b>.
          </p>
        </div>
      </div>
    </LayoutGroup>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding was missing for a long time and it showed on any stage
           tall enough to fill the platter: the content sat flush against the top and
           bottom of the recess while keeping its 16px at the sides, which reads as
           content that has overflowed rather than content that has been placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .tabs {
        width: min(90%, 340px);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .tab-row {
        display: flex;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
        /* a light tint capped at 4%, like every other panel on the page — not a
           flat near-black fill */
        background: rgba(var(--surface-tint-rgb), 0.04);
        border: 1px solid var(--line);
      }

      .tab {
        flex: 1;
        position: relative;
        z-index: 1;
        border: 0;
        background: transparent;
        border-radius: 999px;
        padding: 9px 8px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      .tab.is-on {
        /* the pill sliding underneath is var(--ink) — see .tab-line — so the label
           riding on top needs var(--bg), not a fixed dark, or it goes invisible
           the moment --ink turns dark in light mode instead of light */
        color: var(--bg);
      }

      .tab-line {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--ink);
        box-shadow: 0 10px 24px rgba(255, 59, 31, 0.28);
        z-index: -1;
      }

      .tab-hint {
        margin: 0;
        text-align: center;
        color: var(--ink-dim);
        font-size: 14px;
      }

      .tab-hint b {
        color: var(--ink);
      }

      @container (max-width: 420px) {
        .tabs {
          width: min(92%, 100%);
          max-width: 100%;
        }
      }

      .choreo-site:not([data-theme='light']) .tab.is-on {
        color: #140c0a;
      }
    </style>
  </template>
}

function isOn(tab: Tab, selected: Tab) {
  return tab === selected;
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('tabs', pill, 'pill');

export class SharedTabsDemo extends GalleryDemo {
  static stage = SharedTabs;
}
