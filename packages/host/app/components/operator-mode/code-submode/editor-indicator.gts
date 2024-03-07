import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import { CheckMark, IconPencilCrossedOut } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
  Args: {
    isReadOnly: boolean;
    isSaving: boolean;
  };
}

const CodeSubmodeEditorIndicator: TemplateOnlyComponent<Signature> = <template>
  <style>
    .indicator {
      position: absolute;
      display: flex;
      align-items: center;
      height: 2.5rem;
      bottom: 0;
      right: 0;
      padding: 0 var(--boxel-sp-xxs) 0 var(--boxel-sp-sm);
      border-top-left-radius: var(--boxel-border-radius);
      font: var(--boxel-font-sm);
      font-weight: 500;
      transform: translateX(140px);
      transition: all var(--boxel-transition);
      transition-delay: 5s;
      min-width: 140px;
    }

    .indicator-icon {
      margin-right: var(--boxel-sp-xxs);
    }

    .indicator-saving {
      --icon-color: var(--boxel-highlight);
      background-color: var(--boxel-200);
    }

    .indicator-read-only {
      --icon-color: var(--boxel-800);
      --icon-background-color: #ffd73c;
      background-color: #ffd73c;
    }

    .indicator.visible {
      transform: translateX(0px);
      transition-delay: 0s;
    }
    .save-spinner {
      display: inline-block;
      position: relative;
    }
    .save-spinner-inner {
      display: inline-block;
      position: absolute;
      top: -7px;
    }
    .indicator-msg {
      margin-right: var(--boxel-sp-sm);
    }
    .saved-msg {
      margin-right: var(--boxel-sp-xxs);
    }
  </style>

  {{#if @isReadOnly}}
    <div
      class='indicator indicator-read-only visible'
      data-test-realm-indicator-not-writable
    >
      <span class='indicator-icon'>
        <IconPencilCrossedOut
          width='18px'
          height='18px'
          aria-label='Cannot edit in read-only space'
        />
      </span>
      <span class='indicator-msg'>
        Cannot edit in read-only space
      </span>
    </div>
  {{else}}
    <div class='indicator indicator-saving {{if @isSaving "visible"}}'>
      {{#if @isSaving}}
        <span class='indicator-msg'>
          Now Saving
        </span>
        <span class='save-spinner'>
          <span class='save-spinner-inner'>
            <LoadingIndicator />
          </span>
        </span>
      {{else}}
        <span data-test-saved class='indicator-msg'>
          Saved
        </span>
        <CheckMark width='27' height='27' />
      {{/if}}
    </div>
  {{/if}}
</template>;

export default CodeSubmodeEditorIndicator;
