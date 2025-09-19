import Component from '@glimmer/component';

import {
  type BoxelSpacing,
  calcBoxelSpacing,
  cn,
  element,
  eq,
} from '../../helpers.ts';

export type BoxelContainerDisplayOption =
  | 'default'
  | 'grid'
  | 'inline-grid'
  | 'flex'
  | 'inline-flex';

export interface BoxelContainerSignature {
  Args: {
    display?: BoxelContainerDisplayOption;
    gap?: BoxelSpacing | string;
    padding?: BoxelSpacing | string;
    rowGap?: string | BoxelSpacing;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export default class Container extends Component<BoxelContainerSignature> {
  <template>
    {{#let (element @tag) as |TagName|}}
      <TagName
        class={{cn
          'boxel-container'
          boxel-grid=(eq @display 'grid')
          boxel-inline-grid=(eq @display 'inline-grid')
          boxel-flex=(eq @display 'flex')
          boxel-inline-flex=(eq @display 'inline-flex')
        }}
        style={{this.styles}}
        ...attributes
      >
        {{yield}}
      </TagName>
    {{/let}}
    <style scoped>
      @layer boxelComponentL1 {
        .boxel-grid {
          display: grid;
        }
        .boxel-inline-grid {
          display: inline-grid;
        }
        .boxel-flex {
          display: flex;
        }
        .boxel-inline-flex {
          display: inline-flex;
        }
      }
    </style>
  </template>

  private get styles() {
    let padding = this.args.padding?.length ? this.args.padding : 'default';
    let layout = `padding: ${calcBoxelSpacing(padding)};`;
    if (this.args.display && this.args.display !== 'default') {
      let gap = this.args.gap?.length ? this.args.gap : 'default';
      layout += `gap: ${calcBoxelSpacing(gap)};`;
    }
    return layout;
  }
}
