import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';

import cn from '../../helpers/cn.ts';
import { bool, eq, or } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    detail?: string;
    hasBackground?: boolean;
    hasBottomBorder?: boolean;
    isHighlighted?: boolean;
    size?: 'large';
    title?: string;
    titleIcon?: ComponentLike<{ Element: Element }>;
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
      highlighted=@isHighlighted
      large=(eq @size 'large')
      hasBottomBorder=@hasBottomBorder
    }}
    data-test-boxel-header
    ...attributes
  >
    {{#if (has-block 'icon')}}
      <div class='icon' data-test-boxel-header-icon>
        {{yield to='icon'}}
      </div>
    {{/if}}

    {{#if (or (bool @title) (has-block 'detail') (bool @detail))}}
      <div
        class='title {{if (has-block "detail") "with-detail"}}'
        data-test-boxel-header-title
      >
        {{#if @titleIcon}}<@titleIcon />{{/if}}
        {{#if @title}}{{@title}}{{/if}}
        {{#if (has-block 'detail')}}
          <div data-test-boxel-header-label class='detail'>
            {{yield to='detail'}}
          </div>
        {{else if @detail}}
          <div data-test-boxel-header-label class='detail'>
            {{@detail}}
          </div>
        {{/if}}
      </div>
    {{/if}}

    {{yield}}

    {{#if (has-block 'actions')}}
      <div class='actions' data-test-boxel-header-actions>
        {{yield to='actions'}}
      </div>
    {{/if}}
  </header>
  <style scoped>
    @layer {
      header {
        --inner-boxel-header-title-icon-size: var(
          --boxel-header-title-icon-size,
          1rem
        );
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
        flex-grow: 1;
      }
      .large {
        padding: var(--boxel-header-padding, var(--boxel-sp-xl));
        font: var(--boxel-header-font-weight, 600)
          var(--boxel-header-text-font, var(--boxel-font-sm));
      }

      header.large .title {
        text-align: center;
      }
      header .title > :deep(svg) {
        display: inline-block;
        vertical-align: middle;
        max-height: var(--inner-boxel-header-title-icon-size);
        max-width: var(--inner-boxel-header-title-icon-size);
        margin-right: var(--boxel-sp-xxxs);
        margin-bottom: calc(1rem - var(--boxel-font-size-sm));
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
      .highlighted {
        background-color: var(--boxel-highlight);
      }
      .icon {
        display: flex;
        align-items: center;
        min-width: var(--boxel-header-icon-container-min-width);
        justify-content: left;
      }
      .actions {
        display: flex;
        align-items: center;
        margin-left: auto;
        gap: var(--boxel-sp-xxs);
        min-width: var(--boxel-header-actions-min-width);
        justify-content: right;
      }
    }
  </style>
</template>;

export default Header;
