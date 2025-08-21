import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    hasBackground?: boolean;
    hasBottomBorder?: boolean;
    size?: 'large';
    title?: string;
  };
  Blocks: {
    default: [];
    detail: [];
    icon: [];
  };
  Element: HTMLElement;
}

const Header: TemplateOnlyComponent<Signature> = <template>
  <header
    class={{cn
      large=(eq @size 'large')
      has-background=@hasBackground
      hasBottomBorder=@hasBottomBorder
    }}
    data-test-boxel-header
    ...attributes
  >
    {{#if (has-block 'icon')}}
      {{yield to='icon'}}
    {{/if}}

    {{#if @title}}
      <div class='title boxel-ellipsize' data-test-boxel-header-title>
        {{@title}}
      </div>
    {{/if}}

    {{yield}}

    {{#if (has-block 'detail')}}
      <div class='detail'>
        {{yield to='detail'}}
      </div>
    {{/if}}
  </header>
  <style scoped>
    @layer {
      header {
        --_h-padding: var(--boxel-sp);
        --_h-min-height: 1.875rem; /* 30px */
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--boxel-header-gap, var(--boxel-sp-xs));
        max-width: 100%;
        min-height: var(--boxel-header-min-height, var(--_h-min-height));
        padding: var(--boxel-header-padding, var(--_h-padding));
        background-color: var(
          --boxel-header-background-color,
          var(--_h-bg-color)
        );
        color: var(--boxel-header-text-color, var(--_h-color));
      }
      .large {
        --_h-padding: var(--boxel-sp-xl);
        --_h-title-fs: var(--typescale-h1, var(--boxel-font-size-lg));
        --_h-title-fw: 600;
        --_h-title-lh: calc(30 / 22);
      }
      .hasBottomBorder {
        border-bottom: 1px solid
          var(--boxel-header-border-color, var(--border, var(--boxel-200)));
      }
      .has-background {
        --_h-bg-color: var(--muted, var(--boxel-100));
        --_h-color: var(--muted-foreground, var(--boxel-dark));
      }
      .title {
        font-size: var(--boxel-header-title-font-size, var(--_h-title-fs));
        font-weight: var(--boxel-header-title-font-weight, var(--_h-title-fw));
        line-height: var(
          --boxel-header-title-line-height,
          var(--lineheight-base, var(--_h-title-lh))
        );
      }
      .detail {
        display: flex;
        align-items: center;
        margin-left: var(--boxel-header-detail-margin-left, auto);
      }
      header > :deep(svg, img) {
        flex-shrink: 0;
      }
    }
  </style>
</template>;

export default Header;
