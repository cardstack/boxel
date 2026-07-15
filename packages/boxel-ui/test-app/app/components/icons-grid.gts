import Component from '@glimmer/component';
import { ALL_ICON_COMPONENTS } from '@cardstack/boxel-icons/boxel-icons-meta';
import { Tooltip } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
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
  toggleShowAll = () => {
    this.showAll = !this.showAll;
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
      <div class='boxel-icons-header'>
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
      }
      .boxel-icons-header {
        padding: 0 1rem 1rem;
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-2xs);
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
        .boxel-icons-grid {
          margin-inline: var(--boxel-sp);
          margin-bottom: var(--boxel-sp);
          border: 1px solid var(--border);
          height: 200px;
          border-radius: var(--radius);
        }
      }
    </style>
  </template>
}
