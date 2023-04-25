import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '../../helpers/cn';
import { or, eq, bool } from '../../helpers/truth-helpers';
import Label from '../label';
import './style.css';

interface Signature {
  Element: HTMLElement;
  Args: {
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
      'boxel-header'
      boxel-header--has-background=@hasBackground
      boxel-header--highlighted=@isHighlighted
      boxel-header--large=(or (bool @title) (eq @size 'large'))
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
      <div class='boxel-header__content' data-test-boxel-header-content>
        {{yield to='actions'}}
      </div>
    {{/if}}
  </header>
</template>;

export default Header;
