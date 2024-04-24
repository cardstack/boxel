import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { bool, eq } from '../../helpers/truth-helpers.ts';
import IconPlus from '../../icons/icon-plus.gts';
import PlusCircleIcon from '../../icons/icon-plus-circle.gts';
import IconButton from '../icon-button/index.gts';

interface Signature {
  Args: {
    hideIcon?: boolean;
    iconHeight?: string;
    iconWidth?: string;
    variant?: AddButtonVariant;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export type AddButtonVariant = 'full-width' | 'pill';

const AddButton: TemplateOnlyComponent<Signature> = <template>
  {{#if (bool @variant)}}
    <button
      class={{if
        (eq @variant 'full-width')
        'add-button--full-width'
        'add-button--pill'
      }}
      ...attributes
    >
      {{#unless @hideIcon}}
        <IconPlus
          width={{if @iconWidth @iconWidth '18px'}}
          height={{if @iconHeight @iconHeight '18px'}}
        />
      {{/unless}}
      {{yield}}
    </button>
  {{else}}
    <IconButton
      @icon={{PlusCircleIcon}}
      @width='40px'
      @height='40px'
      class='add-button'
      title='Add'
      data-test-create-new-card-button
      ...attributes
    />
  {{/if}}

  <style>
    .add-button {
      --icon-bg: var(--boxel-light-100);
      --icon-border: var(--icon-bg);
      --icon-color: var(--boxel-highlight);

      border-radius: 100px;
      border: none;
      box-shadow: 0 4px 6px 0px rgb(0 0 0 / 35%);
    }
    .add-button:hover {
      --icon-bg: var(--boxel-light-200);
    }

    .add-button--full-width {
      --icon-color: var(--boxel-highlight);
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--boxel-sp-xxxs);
      box-sizing: border-box;
      width: 100%;
      min-height: 3.75rem;
      padding: var(--boxel-sp-xs);
      background-color: var(--boxel-100);
      border: none;
      border-radius: var(--boxel-form-control-border-radius);
      color: var(--boxel-highlight);
      font: 700 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      transition:
        background-color var(--boxel-transition),
        box-shadow var(--boxel-transition);
    }
    .add-button--full-width:hover:not(:disabled) {
      background-color: var(--boxel-light-200);
      box-shadow: var(--boxel-box-shadow);
      cursor: pointer;
    }

    .add-button--pill {
      --icon-color: var(--boxel-light);
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--boxel-sp-xxxs);
      box-sizing: border-box;
      padding: 4px var(--boxel-sp-sm);
      background-color: var(--boxel-highlight);
      border: none;
      border-radius: var(--boxel-form-control-border-radius);
      color: var(--boxel-light);
      font: 700 var(--boxel-add-button-pill-font, var(--boxel-font-xs));
      letter-spacing: var(--boxel-lsp-xs);
      transition:
        background-color var(--boxel-transition),
        box-shadow var(--boxel-transition);
    }
    .add-button--pill:focus:not(:disabled),
    .add-button--pill:hover:not(:disabled) {
      background-color: var(--boxel-highlight-hover);
      box-shadow: var(--boxel-box-shadow);
      cursor: pointer;
    }
  </style>
</template>;

export default AddButton;
