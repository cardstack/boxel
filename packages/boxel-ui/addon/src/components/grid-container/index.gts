import Component from '@glimmer/component';

import {
  type BoxelSpacing,
  calcBoxelSpacing,
  element,
  sanitizeHtmlSafe,
} from '../../helpers.ts';

interface Signature {
  Args: {
    columnGap?: string | BoxelSpacing;
    columnMaxWidth?: string;
    columnMinWidth?: string;
    columns?: string | number;
    gap?: string | BoxelSpacing;
    maxWidth?: string;
    padding?: string | BoxelSpacing;
    paddingBlock?: string | BoxelSpacing;
    paddingInline?: string | BoxelSpacing;
    rowGap?: string | BoxelSpacing;
    rowMaxHeight?: string;
    rowMinHeight?: string;
    rows?: string | number;
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
      <TagName class='grid-container' style={{this.layoutStyles}} ...attributes>
        {{yield}}
      </TagName>
    {{/let}}
    <style scoped>
      @layer boxelComponentL1 {
        .grid-container {
          display: grid;
          gap: var(--boxel-sp);
          width: 100%;
          max-width: 100%;
        }
      }
    </style>
  </template>

  private get layoutStyles() {
    let layout = '';
    let cols = formatValue(this.args.columns);
    let rows = formatValue(this.args.rows);
    let maxWidth = formatValue(this.args.maxWidth);

    if (cols) {
      let colMin = formatValue(this.args.columnMinWidth);
      let colMax = formatValue(this.args.columnMaxWidth);
      layout += `grid-template-columns: repeat(${cols}, minmax(${
        colMin ?? 0
      }, ${colMax ?? '1fr'}));`;
    }
    if (rows) {
      let rowMin = formatValue(this.args.rowMinHeight);
      let rowMax = formatValue(this.args.rowMaxHeight);
      layout += `grid-template-rows: repeat(${rows}, minmax(${rowMin ?? 0}, ${
        rowMax ?? '1fr'
      }));`;
    }
    if (maxWidth) {
      layout += `max-width: ${maxWidth};`;
    }
    if (this.args.columnGap) {
      layout += `column-gap: ${calcBoxelSpacing(this.args.columnGap)};`;
    }
    if (this.args.rowGap) {
      layout += `row-gap: ${calcBoxelSpacing(this.args.rowGap)};`;
    }
    if (this.args.gap) {
      layout += `gap: ${calcBoxelSpacing(this.args.gap)};`;
    }
    if (this.args.paddingInline) {
      layout += `padding-inline: ${calcBoxelSpacing(this.args.paddingInline)};`;
    }
    if (this.args.paddingBlock) {
      layout += `padding-block: ${calcBoxelSpacing(this.args.paddingBlock)};`;
    }
    if (this.args.padding) {
      layout += `padding: ${calcBoxelSpacing(this.args.padding)};`;
    }
    return sanitizeHtmlSafe(layout);
  }
}

function formatValue(val?: string | number) {
  if (!val) {
    return;
  }
  return val.toString().replace(/;$/, '').trim();
}
