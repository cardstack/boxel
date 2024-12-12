import GlimmerComponent from '@glimmer/component';
import { Pill } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import { CardorFieldTypeIcon } from 'https://cardstack.com/base/card-api';
import QuestionMark from '@cardstack/boxel-icons/question-mark';

interface StatusPillSignature {
  Args: {
    label: string;
    iconDarkColor: string | undefined;
    iconLightColor: string | undefined;
    icon?: CardorFieldTypeIcon;
  };
  Element: HTMLDivElement;
}

//This component is needed bcos of the additional styling of the pill component
//It makes 2 sections, 1 for the icon and 1 for the text
export class StatusPill extends GlimmerComponent<StatusPillSignature> {
  get icon() {
    return this.args.icon ?? QuestionMark;
  }

  <template>
    <Pill
      class='status-pill'
      data-test-selected-type={{@label}}
      style={{htmlSafe (concat 'background-color: ' @iconLightColor ';')}}
      ...attributes
    >
      <:iconLeft>
        <div
          class='status-icon'
          style={{htmlSafe (concat 'background-color: ' @iconDarkColor ';')}}
        >
          <this.icon />
        </div>
      </:iconLeft>
      <:default>
        <span class='status-label-text'>
          {{@label}}
        </span>
      </:default>
    </Pill>
    <style scoped>
      .status-icon {
        border-radius: 0;
        width: 25px;
        height: 25px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .status-icon > svg {
        width: 16px;
        height: 16px;
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
