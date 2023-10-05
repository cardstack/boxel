import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { type WithBoundArgs } from '@glint/template';
import { hash } from '@ember/helper';
import BoxelDropdown from '../dropdown';
import BoxelMenu from '../menu';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    icon: string;
    label: string;
    class?: string;
    contentClass?: string;
    noHoverStyle?: boolean;
    size?: number;
    iconSize?: number;
  };
  Blocks: {
    default: [
      {
        Menu: WithBoundArgs<typeof BoxelMenu, 'closeMenu'>;
        close: () => void;
      },
    ];
  };
}

const DropdownButton: TemplateOnlyComponent<Signature> = <template>
  <BoxelDropdown @contentClass={{@contentClass}}>
    <:trigger as |bindings|>
      <button
        {{bindings}}
        class={{cn
          'boxel-dropdown-button'
          'boxel-dropdown-button__reset'
          'boxel-dropdown-button__trigger'
          @class
        }}
        aria-label={{@label}}
        data-test-boxel-dropdown-button
        ...attributes
      >
        {{#if @icon}}
          {{svgJar
            @icon
            width=(if @iconSize @iconSize 16)
            height=(if @iconSize @iconSize 16)
          }}
        {{/if}}
      </button>
    </:trigger>
    <:content as |dd|>
      {{yield
        (hash Menu=(component BoxelMenu closeMenu=dd.close) close=dd.close)
      }}
    </:content>
  </BoxelDropdown>
  <style>
    @layer {
      /* Remove all default user-agent styles while keeping specificity low */
      :where(.boxel-dropdown-button__reset) {
        all: unset;
      }

      .boxel-dropdown-button__trigger {
        --dropdown-button-size: 30px;

        width: var(--dropdown-button-size);
        height: var(--dropdown-button-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .boxel-dropdown-button__trigger:hover:not(
          .boxel-dropdown-button--no-hover
        ) {
        --icon-color: var(--boxel-highlight);
        cursor: pointer;
      }

      .boxel-dropdown-button__trigger > svg {
        display: block;
        height: 100%;
        margin: auto;
      }
    }
  </style>
</template>;

export default DropdownButton;
