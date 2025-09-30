import GlimmerComponent from '@glimmer/component';
import { Pill } from '@cardstack/boxel-ui/components';

interface Args {
  items: any[] | undefined | null;
}

export default class ListOfPills extends GlimmerComponent<{ Args: Args }> {
  get items() {
    return this.args.items ?? [];
  }

  get hasItems() {
    return this.items.length > 0;
  }

  <template>
    {{#if this.hasItems}}
      <ul class='pill-list'>
        {{#each this.items as |item|}}
          <li class='pill-item'>
            <Pill>{{item.name}}</Pill>
          </li>
        {{/each}}
      </ul>
    {{else}}
      <p class='no-data-text'>None</p>
    {{/if}}
    <style scoped>
      .pill-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      .pill-item {
      }
    </style>
  </template>
}
