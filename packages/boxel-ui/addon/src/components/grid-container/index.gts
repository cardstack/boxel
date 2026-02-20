import Component from '@glimmer/component';

import {
  element,
  fittedFormatById,
  fittedFormatIds,
  sanitizeHtmlSafe,
  type FittedFormatId,
} from '../../helpers.ts';

interface Signature {
  Args: {
    size?: FittedFormatId;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export default class GridContainer extends Component<Signature> {
  <template>
    {{#let (element @tag) as |TagName|}}
      <TagName
        class='grid-container'
        style={{this.containerStyle}}
        ...attributes
      >
        {{yield}}
      </TagName>
    {{/let}}

    <style scoped>
      @layer boxelComponentL1 {
        .grid-container {
          display: grid;
          gap: var(--boxel-sp);
        }
      }

      @layer reset {
        .grid-container :deep(h2),
        .grid-container :deep(h3) {
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

    return sanitizeHtmlSafe(
      `grid-template-columns: repeat(auto-fill, ${formatSpec.width}px); grid-auto-rows: ${formatSpec.height}px;`,
    );
  }
}
