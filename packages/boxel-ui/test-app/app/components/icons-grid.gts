import Component from '@glimmer/component';
import { ALL_ICON_COMPONENTS } from '@cardstack/boxel-icons/meta';
import { Tooltip } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

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
  get boxelIconsComponents() {
    return this.allBoxelIconsComponents.filter((c) => {
      return c.name.toLowerCase().includes(this.iconFilterString.toLowerCase());
    });
  }
  updateIconFilterString = (ev: Event) => {
    this.iconFilterString = (ev.target as HTMLInputElement).value;
  };

  <template>
    <div>
      <div class='boxel-icons-header'>
        <input
          type='text'
          placeholder='Search for an icon'
          class='boxel-input'
          {{on 'input' this.updateIconFilterString}}
        />
        <div class='boxel-icons-count'>
          Showing
          {{this.boxelIconsComponents.length}}
          of
          {{this.allBoxelIconsComponents.length}}
          icons
        </div>
      </div>
      <div class='boxel-icons-grid'>
        {{#each this.boxelIconsComponents as |c|}}
          <div title={{c.name}}>
            <Tooltip>
              <:trigger>
                <c.component />
              </:trigger>
              <:content>
                {{c.name}}
              </:content>
            </Tooltip>
          </div>
        {{/each}}
      </div>
    </div>
    <style>
      .boxel-icons-header {
        padding: 1rem;
        display: flex;
        justify-content: space-between;
      }
      .boxel-icons-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
        gap: 1rem;
        max-height: 500px;
        overflow-y: scroll;
        border: 1px solid #f0f0f0;
      }

      .boxel-icons-grid div {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 80px;
        border-radius: 4px;
        cursor: pointer;
      }

      .boxel-icons-grid div:hover {
        background-color: #f0f0f0;
      }

      .boxel-icons-grid div svg {
        width: 50px;
        height: 50px;
      }
    </style>
  </template>
}
