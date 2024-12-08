import GlimmerComponent from '@glimmer/component';
import { Pill } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import IconComponent from '@cardstack/boxel-icons/captions';

interface StatusPillSignature {
  Args: {
    label: string;
    iconDarkColor: string | undefined;
    iconLightColor: string | undefined;
    icon: typeof IconComponent;
  };
  Element: HTMLDivElement;
}

//This component is needed bcos of the additional styling of the pill component
//It makes 2 sections, 1 for the icon and 1 for the text
export class StatusPill extends GlimmerComponent<StatusPillSignature> {
  <template>
    <Pill
      class='status-pill'
      data-test-selected-type={{@label}}
      {{! template-lint-disable no-inline-styles }}
      style={{htmlSafe (concat 'background-color: ' @iconLightColor ';')}}
    >
      <:iconLeft>
        <@icon
          class='status-icon'
          style={{htmlSafe (concat 'background-color: ' @iconDarkColor ';')}}
        />
      </:iconLeft>
      <:default>
        <span class='status-label-text'>
          {{@label}}
        </span>
      </:default>
    </Pill>
    <style scoped>
      .status-icon {
        --boxel-icon-button-width: var(--boxel-icon-med);
        --boxel-icon-button-height: var(--boxel-icon-med);
        border-radius: 0;
      }
      .status-pill {
        padding: 0;
        border-color: transparent;
        flex: none;
        overflow: hidden;
        align-self: flex-start;
        margin-top: auto;
        flex-shrink: 0;
      }
      .status-label-text {
        font-size: var(--boxel-font-xs);
        font-weight: 600;
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-xxs);
      }
    </style>
  </template>
}
