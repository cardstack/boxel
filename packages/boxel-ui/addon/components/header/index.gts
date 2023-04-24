import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '../../helpers/cn';
import { or, eq, bool } from '../../helpers/truth-helpers';
import Label from '../label';

interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
    title?: string;
    size?: 'large';
    noBackground?: boolean;
    isHighlighted?: boolean;
  };
  Blocks: {
    default: [];
    actions: [];
  };
}

const Header: TemplateOnlyComponent<Signature> = <template>
  <header
    {{!-- Can the first argument be optional? --}}
    class={{cn ''
      --no-background=@noBackground
      --highlighted=@isHighlighted
      --large=(or (bool @title) (eq @size 'large'))
    }}
    data-test-boxel-header
    ...attributes
  >
    {{#if (or @label @title)}}
      <div>
        {{#if @label}}<Label
            data-test-boxel-header-label
          >{{@label}}</Label>{{/if}}
        {{#if @title}}{{@title}}{{/if}}
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
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp-sm);
      min-height: var(--boxel-header-min-height, 1.875rem); /* 30px */
      background-color: var(--boxel-header-background-color, var(--boxel-purple-100));
      color: var(--boxel-header-text-color, var(--boxel-dark));
      border-top-right-radius: calc(var(--boxel-border-radius) - 1px);
      border-top-left-radius: calc(var(--boxel-border-radius) - 1px);
      font: 600 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xl);
      text-transform: uppercase;
      transition:
        background-color var(--boxel-transition),
        color var(--boxel-transition);
    }

    header.--no-background {
      background-color: transparent;
      color: var(--boxel-header-text-color, var(--boxel-purple-400));
    }

    header.--highlighted {
      background-color: var(--boxel-highlight);
      color: var(--boxel-dark);
    }

    .content {
      display: flex;
      align-items: center;
    }

    button {
      --boxel-icon-button-width: var(--boxel-header-min-height, 1.875rem);
      --boxel-icon-button-height: var(--boxel-header-min-height, 1.875rem);

      min-height: var(--boxel-icon-button-height);
      padding: 0 var(--boxel-sp-xxxs);
      background: none;
      border: none;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
    }
  </style>
</template>;

export default Header;
