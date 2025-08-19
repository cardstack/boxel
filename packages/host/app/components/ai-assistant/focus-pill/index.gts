import Component from '@glimmer/component';
import { Pill } from '@cardstack/boxel-ui/components';
import SquareDashedMousePointer from '@cardstack/boxel-icons/square-dashed-mouse-pointer';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    label: string;
    itemType?: string; // e.g. "Schema"
    codeRange?: string; // e.g. "Lines 51–78"
  };
}

export default class FocusPill extends Component<Signature> {
  <template>
    <div class='ai-focus-pill' ...attributes>
      <Pill class='main'>
        <:iconLeft>
          <SquareDashedMousePointer width='18' height='18' />
        </:iconLeft>
        <:default>
          <span class='label' title={{@label}}>{{@label}}</span>
        </:default>
      </Pill>

      {{#if @itemType}}
        <Pill class='meta'>
          {{@itemType}}
        </Pill>
      {{/if}}

      {{#if @codeRange}}
        <Pill class='meta'>
          {{@codeRange}}
        </Pill>
      {{/if}}
    </div>

    <style scoped>
      .ai-focus-pill {
        --pill-font: 600 var(--boxel-font-sm);
        --pill-gap: var(--boxel-sp-4xs);
        --boxel-pill-background-color: transparent;
        --boxel-pill-border-color: transparent;

        align-items: center;
        background: var(--boxel-200);
        border-radius: var(--boxel-border-radius-sm);
        display: inline-flex;
        gap: var(--boxel-sp-xxs);
        height: 30px;
        max-width: 100%;
        padding-right: var(--boxel-sp-xxs);
      }
      .ai-focus-pill:hover {
        filter: brightness(0.95);
      }

      .main {
        --pill-padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);

        min-width: 0;
      }

      .main > :deep(.icon) {
        flex-shrink: 0;
      }

      .main > :deep(.icon > *) {
        width: var(--pill-icon-size, 1rem);
        height: var(--pill-icon-size, 1rem);
      }

      .main .label {
        display: inline-block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .meta {
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-3xs);
        --pill-font: 600 var(--boxel-font-xs);
        --pill-border-radius: var(--boxel-border-radius-xs);
        --boxel-pill-background-color: #777;
        --boxel-pill-font-color: var(--boxel-light);

        flex-shrink: 0;
        height: 22px;
      }
    </style>
  </template>
}
