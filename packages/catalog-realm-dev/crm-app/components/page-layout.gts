import GlimmerComponent from '@glimmer/component';

import type { Format } from 'https://cardstack.com/base/card-api';

import { cn } from '@cardstack/boxel-ui/helpers';

interface PageLayoutArgs {
  Args: {
    format?: Format;
  }
  Blocks: {
    header: [];
    summary: [];
    content: [];
  };
  Element: HTMLElement;
}

export default class PageLayout extends GlimmerComponent<PageLayoutArgs> {
  <template>
    <div class={{cn 'page-layout' @format}} ...attributes>
      {{yield to='header'}}
      {{yield to='summary'}}
      {{yield to='content'}}
    </div>

    <style scoped>
      @layer {
        .page-layout {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          width: 100%;
          padding: var(--boxel-sp-xl);
        }
        .page-layout.isolated {
          height: max-content;
          min-height: 100%;
          background-color: var(--boxel-100);
        }
      }
    </style>
  </template>
}
