import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import { bool, eq, or } from '../../helpers/truth-helpers.ts';
import Label from '../label/index.gts';

interface Signature {
  Args: {
    hasBackground?: boolean;
    isHighlighted?: boolean;
    label?: string;
    size?: 'large';
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
      highlighted=@isHighlighted
      large=(or (bool @title) (eq @size 'large'))
    }}
    data-test-boxel-header
    ...attributes
  >
    {{#if (has-block 'icon')}}
      {{yield to='icon'}}
    {{/if}}

    {{#if (or @label @title)}}
      <div
        class='title {{if (has-block "detail") "with-detail"}}'
        data-test-boxel-header-title
      >
        {{#if @label}}
          <Label data-test-boxel-header-label>
            {{@label}}
          </Label>
        {{/if}}
        {{#if @title}}{{@title}}{{/if}}
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
  <style>
    @layer {
      header {
        position: relative;
        display: flex;
        align-items: center;
        padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp-sm);
        min-height: var(--boxel-header-min-height, 1.875rem); /* 30px */
        color: var(--boxel-header-text-color, var(--boxel-dark));
        border-top-right-radius: calc(var(--boxel-border-radius) - 1px);
        border-top-left-radius: calc(var(--boxel-border-radius) - 1px);
        font: 600 var(--boxel-header-text-size, var(--boxel-font-xs));
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
        transition:
          background-color var(--boxel-transition),
          color var(--boxel-transition);
        gap: var(--boxel-sp-xs);
      }
      header .title {
        max-width: var(
          --boxel-header-max-width,
          calc(100% - 10rem)
        ); /* this includes the space to show the header buttons */
        text-overflow: ellipsis;
        overflow: hidden;
        text-wrap: nowrap;
      }
      .header .title.with-detail {
        max-width: var(
          --boxel-header-detail-max-width,
          calc(100% - 23rem)
        ); /* fits last saved message */
      }
      .large {
        padding: var(--boxel-header-padding, var(--boxel-sp-xl));
        font: 700 var(--boxel-header-text-size, var(--boxel-font-lg));
        letter-spacing: var(--boxel-header-letter-spacing, normal);
        text-transform: var(--boxel-header-text-transform, none);
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
      .content {
        display: flex;
        align-items: center;
        margin-left: auto;
      }
      .detail {
        margin-left: var(--boxel-header-detail-margin-left, 0);
      }
    }
  </style>
</template>;

export default Header;
