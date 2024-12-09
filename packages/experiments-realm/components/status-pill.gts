import GlimmerComponent from '@glimmer/component';
import { Pill } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import IconComponent from '@cardstack/boxel-icons/captions';
import QuestionMark from '@cardstack/boxel-icons/question-mark';

interface StatusPillSignature {
  Args: {
    label: string;
    iconDarkColor: string | undefined;
    iconLightColor: string | undefined;
    icon?: typeof IconComponent;
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
      {{! template-lint-disable no-inline-styles }}
      style={{htmlSafe (concat 'background-color: ' @iconLightColor ';')}}
    >
      <:iconLeft>
        <this.icon
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
