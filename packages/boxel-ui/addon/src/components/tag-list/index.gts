import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import Pill from '../pill/index.gts';

export type TagItem = {
  displayName: string;
  icon?: string;
  id: string;
};

export interface TagListSignature {
  Args: {
    onTagSelect: (tag: TagItem) => void;
    selectedTags: TagItem[];
    tags: TagItem[];
  };
  Element: HTMLElement;
}

export default class TagList extends Component<TagListSignature> {
  get isTagSelected() {
    return (itemId: string) =>
      this.args.selectedTags.some((tag) => tag.id === itemId);
  }

  <template>
    <div class='tag-list' ...attributes>
      {{#each @tags as |tag|}}
        <Pill
          @kind='button'
          class={{concat
            'tag-list-pill'
            (if (this.isTagSelected tag.id) ' selected')
          }}
          {{on 'click' (fn @onTagSelect tag)}}
          data-test-tag-list-pill={{tag.id}}
        >
          <:default>
            <span>{{tag.displayName}}</span>
          </:default>
        </Pill>
      {{/each}}
    </div>

    <style scoped>
      @layer {
        .tag-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--tag-list-gap, var(--boxel-sp-xs));
        }

        .tag-list-pill {
          --pill-background-color: var(
            --tag-list-pill-background-color,
            var(--boxel-light)
          );
          --pill-background-color-hover: var(
            --tag-list-pill-background-color-hover,
            var(--boxel-200)
          );
          --pill-font-color: var(--tag-list-pill-font-color, var(--boxel-dark));
          transition: var(--tag-list-pill-transition, all 0.2s ease);
        }

        .tag-list-pill.selected {
          --pill-background-color: var(
            --tag-list-pill-selected-background-color,
            var(--boxel-dark)
          );
          --pill-background-color-hover: var(
            --tag-list-pill-selected-background-color,
            var(--boxel-dark)
          );
          --pill-font-color: var(
            --tag-list-pill-selected-font-color,
            var(--boxel-light)
          );
        }
      }
    </style>
  </template>
}
