import Component from '@glimmer/component';
import { IconButton } from '@cardstack/boxel-ui';

export default class CardCatalogFilters extends Component {
  <template>
    <div class='filters'>
      <IconButton
        class='add-filter-button'
        @icon='icon-plus'
        @width='20'
        @height='20'
        aria-label='add filter'
      />
      <ul class='filter-list'>
        <li class='filter'>
          Realm: All
        </li>
      </ul>
    </div>

    <style>
      .filters {
        --filter-height: 30px;
        display: flex;
        gap: var(--boxel-sp-xs);
        font: 500 var(--boxel-font-sm);
      }
      .add-filter-button {
        --icon-color: var(--boxel-highlight);
        border: 1px solid var(--boxel-400);
        border-radius: 100px;
        width: var(--filter-height);
        height: var(--filter-height);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .add-filter-button {
        border-color: var(--boxel-dark);
      }
      .filter-list {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-flow: row wrap;
        gap: var(--boxel-sp-xs);
      }
      .filter {
        position: relative;
        height: var(--filter-height);
        border: 1px solid var(--boxel-400);
        border-radius: 20px;
        padding-right: var(--boxel-sp-lg);
        padding-left: var(--boxel-sp-sm);
        display: flex;
        align-items: center;
      }
    </style>
  </template>
}
