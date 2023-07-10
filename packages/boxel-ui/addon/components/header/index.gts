import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '../../helpers/cn';
import { or, eq, bool } from '../../helpers/truth-helpers';
import Label from '../label';

interface Signature {
  Element: HTMLElement;
  Args: {
    iconURL?: string;
    label?: string;
    title?: string;
    size?: 'large';
    hasBackground?: boolean;
    isHighlighted?: boolean;
  };
  Blocks: {
    default: [];
    actions: [];
  };
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
    {{#if (or @label @title @iconURL) }}
      <div class="header__row">
        {{#if @iconURL}}
          <img class="header__icon" src={{@iconURL}} data-test-boxel-header-icon={{@iconURL}}/>
        {{/if}}
        <div data-test-boxel-header-title>
          {{#if @label}}<Label
              data-test-boxel-header-label
            >{{@label}}</Label>{{/if}}
          {{#if @title}}{{@title}}{{/if}}
        </div>
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
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp-sm);
      min-height: var(--boxel-header-min-height, 1.875rem); /* 30px */
      color: var(--boxel-header-text-color, var(--boxel-dark));
      border-top-right-radius: calc(var(--boxel-border-radius) - 1px);
      border-top-left-radius: calc(var(--boxel-border-radius) - 1px);
      font: 600 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xl);
      text-transform: uppercase;
      transition: background-color var(--boxel-transition),
        color var(--boxel-transition);
    }
    .large {
      padding: var(--boxel-sp-xl);
      font: 700 var(--boxel-font-lg);
      letter-spacing: normal;
      text-transform: none;
    }
    .has-background {
      background-color: var(--boxel-header-background-color, var(--boxel-100));
    }
    .highlighted {
      background-color: var(--boxel-highlight);
    }
    .content {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      align-items: center;
    }
    .header__row {
      display: flex;
      flex-direction: row;
      gap: var(--boxel-sp-xs);
      align-items: center;
    }
    .header__icon {
      width: var(--boxel-header-icon-width, 20px);
      height: var(--boxel-header-icon-height, 20px);
    }
  </style>
</template>;

export default Header;
