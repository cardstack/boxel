import Component from '@glimmer/component';
import { ALL_ICON_COMPONENTS } from '@cardstack/boxel-icons/boxel-icons-meta';
import { Tooltip } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { cn } from '@cardstack/boxel-ui/helpers';

import {
  BoxelInput,
  FieldContainer,
  Switch,
} from '@cardstack/boxel-ui/components';

function importStatement(name: string): string {
  return `import ${toPascalCase(name)} from '@cardstack/boxel-icons/${name}';`;
}

function toPascalCase(text: string): string {
  return text.replace(/(^\w|-\w)/g, clearAndUpper);
}

function clearAndUpper(text: string): string {
  return text.replace(/-/, '').toUpperCase();
}

class Copyable {
  @tracked recentlyCopied = false;
  copyToClipboard = (text: string) => {
    return (_ev: Event) => {
      navigator.clipboard.writeText(text);
      this.recentlyCopied = true;
      setTimeout(() => {
        this.recentlyCopied = false;
      }, 2000);
    };
  };
}

function makeCopyable() {
  return new Copyable();
}

export default class IconsGridComponent extends Component {
  get allBoxelIconsComponents() {
    return ALL_ICON_COMPONENTS.map((c) => {
      return {
        name: c.name,
        component: c,
      };
    });
  }
  @tracked iconFilterString = '';
  @tracked showAll = false;
  @tracked isHeaderStuck = false;
  sentinelElement: Element | undefined;
  // The sentinel sits at the container top, exactly where the sticky header
  // rests before it pins. Once it leaves the viewport the header is stuck.
  detectHeaderStuck = modifier((element: Element) => {
    this.sentinelElement = element;
    let observer = new IntersectionObserver(([entry]) => {
      this.isHeaderStuck = !entry.isIntersecting;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      this.sentinelElement = undefined;
    };
  });
  toggleShowAll = () => {
    this.showAll = !this.showAll;
    // Collapsing the expanded grid can leave the page scrolled deep into
    // content that no longer exists; return to the top of the icons section.
    if (!this.showAll && this.isHeaderStuck) {
      this.sentinelElement?.scrollIntoView({ block: 'start' });
    }
  };
  get boxelIconsComponents() {
    return this.allBoxelIconsComponents.filter((c) => {
      return c.name.toLowerCase().includes(this.iconFilterString.toLowerCase());
    });
  }
  updateIconFilterString = (value: string) => {
    this.iconFilterString = value;
  };

  <template>
    <div class='boxel-lucide-icons'>
      <div class='boxel-icons-header-sentinel' {{this.detectHeaderStuck}} />
      <div class={{cn 'boxel-icons-header' is-stuck=this.isHeaderStuck}}>
        <FieldContainer
          class='boxel-icon-search'
          @tag='label'
          @label='Filter'
          @inline={{true}}
        >
          <BoxelInput
            type='search'
            placeholder='Search for an icon'
            @onInput={{this.updateIconFilterString}}
          />
        </FieldContainer>
        <FieldContainer
          class='boxel-icons-show-all'
          @tag='label'
          @label='Show All'
          @inline={{true}}
        >
          <Switch
            @label='Show All'
            @isEnabled={{this.showAll}}
            @onChange={{this.toggleShowAll}}
          />
        </FieldContainer>
        <div class='boxel-icons-count'>
          Showing
          {{this.boxelIconsComponents.length}}
          of
          {{this.allBoxelIconsComponents.length}}
          icons
        </div>
      </div>
      <div class={{cn 'boxel-icons-grid' show-all=this.showAll}}>
        {{#each this.boxelIconsComponents as |c|}}
          <div class='boxel-icons-grid-item'>
            {{#let (makeCopyable) as |copyable|}}
              <Tooltip>
                <:trigger>
                  <c.component
                    {{on
                      'click'
                      (copyable.copyToClipboard (importStatement c.name))
                    }}
                  />
                </:trigger>
                <:content>
                  {{#if copyable.recentlyCopied}}
                    Copied!
                  {{else}}
                    {{c.name}}
                    <br />
                    <code>{{importStatement c.name}}</code>
                  {{/if}}
                </:content>
              </Tooltip>
            {{/let}}
          </div>
        {{/each}}
      </div>
    </div>
    <style scoped>
      .boxel-lucide-icons {
        --bli-item-size: 50px;
        position: relative;
      }
      .boxel-icons-header-sentinel {
        position: absolute;
        top: 0;
        height: 1px;
        width: 1px;
      }
      .boxel-icons-header {
        position: sticky;
        top: 0;
        z-index: 1;
        background-color: var(--background);
        margin-top: -1rem;
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        transition: box-shadow 200ms ease;
      }
      .boxel-icons-header.is-stuck {
        box-shadow: 0 4px 8px -4px
          color-mix(in oklab, var(--foreground) 30%, transparent);
      }
      .boxel-icon-search {
        --boxel-input-height: var(--boxel-button-sm);
        --boxel-input-width: 10rem;
      }
      .boxel-icons-grid {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(var(--bli-item-size), 1fr)
        );
        gap: 1rem;
        max-height: 500px;
        overflow-y: scroll;
        border-top: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
      }
      .boxel-icons-grid.show-all {
        max-height: none;
        overflow-y: visible;
      }
      .boxel-icons-grid-item {
        display: flex;
        justify-content: center;
        align-items: center;
        height: var(--bli-item-size);
        border-radius: 4px;
        cursor: pointer;
      }
      .boxel-icons-grid-item:hover {
        background-color: color-mix(
          in oklab,
          var(--foreground) 10%,
          transparent
        );
      }
      .boxel-icons-grid-item svg {
        width: 30px;
        height: 30px;
      }

      @media (max-width: 599px) {
        .boxel-icons-header {
          --boxel-label-font-size: var(--boxel-font-size-xs);
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
        .boxel-icons-count {
          font-size: var(--boxel-font-size-xs);
        }
        .boxel-icons-grid {
          margin-inline: var(--boxel-sp);
          margin-bottom: var(--boxel-sp);
          border: 1px solid var(--border);
          max-height: 200px;
          border-radius: var(--radius);
        }
      }
    </style>
  </template>
}
