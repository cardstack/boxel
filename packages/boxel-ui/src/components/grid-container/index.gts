import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

import {
  type FittedFormatId,
  element,
  fittedFormatById,
  fittedFormatIds,
  sanitizeHtmlSafe,
} from '../../helpers.ts';
import GridItemContainer, {
  type GridItemContainerSignature,
} from './grid-item-container/index.gts';

interface Signature {
  Args: {
    fullWidthItem?: boolean;
    items?: any[];
    size?: FittedFormatId;
    tag?: keyof HTMLElementTagNameMap;
    viewFormat?: 'list' | 'grid';
  };
  Blocks: {
    default:
      | [
          item: any,
          GridItemContainer: ComponentLike<GridItemContainerSignature>,
        ]
      | [];
  };
  Element: HTMLElement;
}

export default class GridContainer extends Component<Signature> {
  <template>
    {{#let (element @tag) as |TagName|}}
      <TagName
        class='boxel-grid-container'
        style={{this.containerStyle}}
        ...attributes
      >
        {{#if @items}}
          {{#each @items as |item i|}}
            {{yield
              item
              (component
                GridItemContainer size=@size fullWidth=@fullWidthItem index=i
              )
            }}
          {{/each}}
        {{else}}
          {{yield}}
        {{/if}}
      </TagName>
    {{/let}}

    <style scoped>
      @layer boxelComponentL1 {
        .boxel-grid-container {
          display: grid;
          gap: var(--boxel-sp);
        }
      }

      @layer reset {
        .boxel-grid-container :deep(h2),
        .boxel-grid-container :deep(h3) {
          margin: 0;
        }
      }
    </style>
  </template>

  get formatSpec() {
    let size = this.args.size;

    if (!size) {
      return null;
    }

    if (!fittedFormatIds?.includes(size)) {
      console.error(
        `Size "${size}" does not exist in fitted format sizes. Please choose from ${fittedFormatIds.join(', ')}`,
      );
      return null;
    }

    return fittedFormatById.get(size) ?? null;
  }

  get containerStyle() {
    let formatSpec = this.formatSpec;

    if (!formatSpec) {
      return sanitizeHtmlSafe('');
    }

    if (this.args.items) {
      if (this.args.viewFormat === 'list') {
        return sanitizeHtmlSafe('grid-template-columns: 1fr;');
      }
      return sanitizeHtmlSafe(
        `grid-template-columns: repeat(auto-fill, ${formatSpec.width}px);`,
      );
    } else {
      if (this.args.viewFormat === 'list') {
        return sanitizeHtmlSafe(
          `grid-template-columns: 1fr; grid-auto-rows: ${formatSpec.height}px`,
        );
      }
      return sanitizeHtmlSafe(
        `grid-template-columns: repeat(auto-fill, ${formatSpec.width}px); grid-auto-rows: ${formatSpec.height}px`,
      );
    }
  }
}
