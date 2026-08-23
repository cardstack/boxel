import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion } from 'glimmer-motion';

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
      <div class="ex">
        <div class="tabs">
          <div class="tab-row">
            {{#each tabs as |tab|}}
              <button
                type="button"
                class={{if (isOn tab this.selected) "tab is-on" "tab"}}
                {{on "click" (fn this.select tab)}}
              >
                {{#if (isOn tab this.selected)}}
                  <span
                    class="tab-line"
                    {{motion layoutId="tab-pill" transition=pill}}
                  ></span>
                {{/if}}
                {{tab}}
              </button>
            {{/each}}
          </div>
          <p class="tab-hint">
            The highlight is one node. It moves to
            <b>{{this.selected}}</b>.
          </p>
        </div>
      </div>
    </LayoutGroup>
  </template>
}

function isOn(tab: Tab, selected: Tab) {
  return tab === selected;
}
