import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';

import { bool, or } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    title?: string;
    titleIcon?: ComponentLike<{ Element: Element }>;
  };
  Blocks: {
    actions: [];
    detail: [];
    realmIcon: [];
  };
  Element: HTMLElement;
}

const Header: TemplateOnlyComponent<Signature> = <template>
  <header data-test-boxel-header ...attributes>
    {{#if (has-block 'realmIcon')}}
      <div class='realm-icon'>
        {{yield to='realmIcon'}}
      </div>
    {{/if}}

    {{#if (or (bool @title) (has-block 'detail'))}}
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
        {{/if}}
      </div>
    {{/if}}

    {{#if (has-block 'actions')}}
      <div class='actions' data-test-boxel-header-actions>
        {{yield to='actions'}}
      </div>
    {{/if}}
  </header>
  <style scoped>
    @layer {
      header {
        --inner-boxel-card-header-title-icon-size: var(
          --boxel-card-header-title-icon-size,
          1rem
        );
        --default-header-padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp-sm);
        position: relative;
        display: flex;
        align-items: center;
        min-height: var(--boxel-card-header-min-height, 1.875rem); /* 30px */
        color: var(--boxel-card-header-text-color, var(--boxel-dark));
        background-color: var(
          --boxel-card-header-background-color,
          var(--boxel-100)
        );
        border-top-right-radius: calc(
          var(--boxel-card-header-border-radius, var(--boxel-border-radius)) -
            1px
        );
        border-top-left-radius: calc(
          var(--boxel-card-header-border-radius, var(--boxel-border-radius)) -
            1px
        );
        letter-spacing: var(--boxel-card-header-letter-spacing, normal);
        text-transform: var(--boxel-card-header-text-transform);
        transition:
          background-color var(--boxel-transition),
          color var(--boxel-transition);
        gap: var(--boxel-card-header-gap, var(--boxel-sp-xs));
        padding: var(--boxel-card-header-padding, var(--boxel-sp-xl));
        font: var(--boxel-card-header-font-weight, 600)
          var(--boxel-card-header-text-font, var(--boxel-font-sm));
      }
      header .title {
        max-width: var(
          --boxel-card-header-max-width,
          100%
        ); /* this includes the space to show the header buttons */
        text-overflow: var(--boxel-card-header-text-overflow, ellipsis);
        overflow: hidden;
        text-wrap: nowrap;
        flex-grow: 1;
        text-align: center;
      }

      header .title > :deep(svg) {
        display: inline-block;
        vertical-align: middle;
        max-height: var(--inner-boxel-card-header-title-icon-size);
        max-width: var(--inner-boxel-card-header-title-icon-size);
        margin-right: var(--boxel-sp-xxxs);
        margin-bottom: calc(1rem - var(--boxel-font-size-sm));
      }
      .realm-icon {
        display: flex;
        align-items: center;
        min-width: var(--boxel-card-header-icon-container-min-width);
        justify-content: left;
      }
      .actions {
        display: flex;
        align-items: center;
        margin-left: auto;
        gap: var(--boxel-sp-xxs);
        min-width: var(--boxel-card-header-actions-min-width);
        justify-content: right;
      }
    }
  </style>
</template>;

export default Header;
