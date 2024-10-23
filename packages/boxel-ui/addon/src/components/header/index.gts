import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import { eq, or } from '../../helpers/truth-helpers.ts';
import Label from '../label/index.gts';

interface Signature {
  Args: {
    hasBackground?: boolean;
    hasBottomBorder?: boolean;
    size?: 'large';
    subtitle?: string;
    title?: string;
  };
  Blocks: {
    actions: [];
    default: [];
    detail: [];
    icon: [];
  };
  Element: HTMLElement;
}

const Header: TemplateOnlyComponent<Signature> = <template>
  <header
    class={{cn
      has-background=@hasBackground
      large=(eq @size 'large')
      hasBottomBorder=@hasBottomBorder
    }}
    data-test-boxel-header
    ...attributes
  >
    {{#if (has-block 'icon')}}
      {{yield to='icon'}}
    {{/if}}

    {{#if (or @subtitle @title)}}
      <div
        class='title {{if (has-block "detail") "with-detail"}}'
        data-test-boxel-header-title
      >
        {{#if @title}}{{@title}}{{/if}}
        {{#if @subtitle}}
          <Label data-test-boxel-header-label>
            {{@subtitle}}

          </Label>
        {{/if}}
      </div>
    {{/if}}

    {{#if (has-block 'detail')}}
      <div class='detail'>
        {{yield to='detail'}}
      </div>
    {{/if}}

    {{yield}}

    {{#if (has-block 'actions')}}
      <div class='content' data-test-boxel-header-content>
        {{yield to='actions'}}
      </div>
    {{/if}}
  </header>
  <style scoped>
    @layer {
      header {
        --default-header-padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp-sm);
        position: relative;
        display: flex;
        align-items: center;
        min-height: var(--boxel-header-min-height, 1.875rem); /* 30px */
        color: var(--boxel-header-text-color, var(--boxel-dark));
        border-top-right-radius: calc(
          var(--boxel-header-border-radius, var(--boxel-border-radius)) - 1px
        );
        border-top-left-radius: calc(
          var(--boxel-header-border-radius, var(--boxel-border-radius)) - 1px
        );
        font: var(--boxel-header-font-weight, 600)
          var(--boxel-header-text-font, var(--boxel-font-sm));
        letter-spacing: var(--boxel-header-letter-spacing, normal);
        text-transform: var(--boxel-header-text-transform);
        transition:
          background-color var(--boxel-transition),
          color var(--boxel-transition);
        gap: var(--boxel-header-gap, var(--boxel-sp-xs));
        padding: var(--boxel-header-padding, var(--default-header-padding));
      }
      header .title {
        max-width: var(
          --boxel-header-max-width,
          100%
        ); /* this includes the space to show the header buttons */
        text-overflow: var(--boxel-header-text-overflow, ellipsis);
        overflow: hidden;
        text-wrap: nowrap;
      }
      header .title.with-detail {
        max-width: var(
          --boxel-header-detail-max-width,
          calc(100% - 23rem)
        ); /* fits last saved message */
      }
      .large {
        padding: var(--boxel-header-padding, var(--boxel-sp-xl));
        font: var(--boxel-header-font-weight, 600)
          var(--boxel-header-text-font, var(--boxel-font-lg));
      }
      .hasBottomBorder {
        border-bottom: 1px solid
          var(--boxel--header-border-color, var(--boxel-200));
      }
      .has-background {
        background-color: var(
          --boxel-header-background-color,
          var(--boxel-100)
        );
      }
      .content {
        display: flex;
        align-items: center;
        margin-left: auto;
        gap: var(--boxel-sp-xxs);
      }
      .detail {
        margin-left: var(--boxel-header-detail-margin-left, auto);
      }
    }
  </style>
</template>;

export default Header;
