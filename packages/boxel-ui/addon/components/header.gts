
import type { TemplateOnlyComponent } from '@ember/component/template-only';
// import cn from '@cardstack/boxel/helpers/cn';

// import '@cardstack/boxel/styles/global.css';
// import './index.css';

interface Signature {
  Element: HTMLElement;
  Args: {
    header?: string;
    noBackground?: boolean;
    isHighlighted?: boolean;
  };
  Blocks: {
    default: [],
    actions: [],
  }
}

const Header: TemplateOnlyComponent<Signature> = <template>
  <header class="boxel-header"
    {{!-- class={{cn
      "boxel-header"
      boxel-header--no-background=@noBackground
      boxel-header--highlighted=@isHighlighted
    }} --}}
    data-test-boxel-header
    ...attributes
  >
    {{#if @header}}
      <span data-test-boxel-header-label>
        {{@header}}
      </span>
    {{/if}}

    {{yield}}

    {{#if (has-block "actions")}}
      <div class="boxel-header__content" data-test-boxel-header-content>
        {{yield to="actions"}}
      </div>
    {{/if}}
  </header>
</template>
export default Header;
