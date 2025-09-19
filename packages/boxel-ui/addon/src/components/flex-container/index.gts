import Component from '@glimmer/component';

import {
  type BoxelSpacing,
  calcBoxelSpacing,
  sanitizeHtmlSafe,
} from '../../helpers.ts';
import BoxelContainer, {
  type BoxelContainerSignature,
} from '../container/index.gts';

interface Signature extends BoxelContainerSignature {
  Args: {
    alignContent?: string;
    alignItems?: string;
    alignSelf?: string;
    columnGap?: string | BoxelSpacing;
    flexDirection?: string;
    flexWrap?: string;
    gap?: string | BoxelSpacing;
    justifyContent?: string;
    justifyItems?: string;
    justifySelf?: string;
    maxWidth?: string;
    padding?: string | BoxelSpacing;
    paddingBlock?: string | BoxelSpacing;
    paddingInline?: string | BoxelSpacing;
    rowGap?: string | BoxelSpacing;
    tag?: keyof HTMLElementTagNameMap;
  };
}

export default class FlexContainer extends Component<Signature> {
  <template>
    <BoxelContainer
      class='boxel-flex-container'
      @tag={{@tag}}
      @display='flex'
      style={{this.flexStyles}}
      ...attributes
    >
      {{yield}}
    </BoxelContainer>
  </template>

  private get flexStyles() {
    let layout = '';
    let maxWidth = formatValue(this.args.maxWidth);

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

    if (this.args.flexDirection) {
      layout += `flex-direction: ${formatValue(this.args.flexDirection)};`;
    }
    if (this.args.flexWrap) {
      layout += `flex-wrap: ${formatValue(this.args.flexWrap)};`;
    }

    if (this.args.alignContent) {
      layout += `align-content: ${formatValue(this.args.alignContent)};`;
    }
    if (this.args.alignItems) {
      layout += `align-items: ${formatValue(this.args.alignItems)};`;
    }
    if (this.args.alignSelf) {
      layout += `align-self: ${formatValue(this.args.alignSelf)};`;
    }

    if (this.args.justifyContent) {
      layout += `justify-content: ${formatValue(this.args.justifyContent)};`;
    }
    if (this.args.justifyItems) {
      layout += `justify-items: ${formatValue(this.args.justifyItems)};`;
    }
    if (this.args.justifySelf) {
      layout += `justify-self: ${formatValue(this.args.justifySelf)};`;
    }

    return sanitizeHtmlSafe(layout);
  }
}

function formatValue(val?: string | number) {
  if (typeof val === 'number') {
    val = val.toString();
  }
  return val?.replace(/;$/, '')?.trim();
}
