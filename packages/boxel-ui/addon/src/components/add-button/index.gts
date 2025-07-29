import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { bool, eq } from '../../helpers/truth-helpers.ts';
import IconPlus from '../../icons/icon-plus.gts';
import IconButton from '../icon-button/index.gts';
import LoadingIndicator from '../loading-indicator/index.gts';

interface Signature {
  Args: {
    hideIcon?: boolean;
    iconHeight?: string;
    iconWidth?: string;
    loading?: boolean;
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
    {{#if (bool @loading)}}
      <div class='add-button loading'>
        <LoadingIndicator />
      </div>
    {{else}}
      <IconButton
        @icon={{IconPlus}}
        @width='20px'
        @height='20px'
        class='add-button'
        aria-label='Add'
        data-test-create-new-card-button
        ...attributes
      />
    {{/if}}
  {{/if}}

  <style scoped>
    .add-button {
      padding: var(--boxel-sp-xs);
      background-color: var(--background, var(--boxel-light));
      color: var(--foreground, var(--boxel-dark));
      border-radius: 50%;
      border: none;
      box-shadow: 0 4px 6px 0px rgb(0 0 0 / 35%);
    }

    .add-button--full-width {
      --_bg-color: var(--muted, var(--boxel-100));
      --_bg-color-mix: color-mix(in oklab, var(--_bg-color) 90%, transparent);
      --_radius: var(--radius, var(--boxel-form-control-border-radius));
      --_color: var(--foreground, var(--boxel-dark));
      --_shadow: var(--shadow, var(--boxel-box-shadow));
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--boxel-sp-xxxs);
      box-sizing: border-box;
      width: 100%;
      min-height: 3.75rem;
      padding: var(--boxel-sp-xs);
      background-color: var(--_bg-color);
      border: none;
      border-radius: var(--_radius);
      color: var(--_color);
      font: 600 var(--boxel-font-sm);
      font-family: inherit;
      letter-spacing: var(--boxel-lsp-xs);
      transition: var(--boxel-transition-properties);
    }
    .add-button--full-width:hover:not(:disabled) {
      background-color: var(--_bg-color-mix, var(--boxel-light-200));
      box-shadow: var(--_shadow);
      cursor: pointer;
    }

    .add-button--pill {
      --_radius: var(--radius, var(--boxel-form-control-border-radius));
      --_shadow: var(--shadow, var(--boxel-box-shadow));
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--boxel-sp-xxxs);
      box-sizing: border-box;
      padding: 4px var(--boxel-sp-sm);
      background-color: var(--boxel-highlight);
      border: none;
      border-radius: var(--_radius);
      color: var(--boxel-dark);
      font: 600 var(--boxel-add-button-pill-font, var(--boxel-font-xs));
      font-family: inherit;
      letter-spacing: var(--boxel-lsp-xs);
      transition: var(--boxel-transition-properties);
    }
    .add-button--pill:focus:not(:disabled),
    .add-button--pill:hover:not(:disabled) {
      background-color: var(--boxel-highlight-hover);
      box-shadow: var(--_shadow);
      cursor: pointer;
    }

    .loading {
      width: 40px;
      height: 40px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  </style>
</template>;

export default AddButton;
