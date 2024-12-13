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
    <div class='status-pill-group' ...attributes>
      <div
        class='status-icon'
        style={{htmlSafe (concat 'background-color: ' @iconDarkColor ';')}}
      >
        <this.icon />
      </div>
      <Pill
        class='status-pill'
        data-test-selected-type={{@label}}
        style={{htmlSafe (concat 'background-color: ' @iconLightColor ';')}}
      >
        <:default>
          <span class='status-label-text'>
            {{@label}}
          </span>
        </:default>
      </Pill>
    </div>
    <style scoped>
      .status-pill-group {
        display: inline-flex;
        align-items: stretch;
        border-radius: var(--boxel-border-radius-xs);
        overflow: hidden;
        margin-top: auto;
        width: fit-content;
        height: fit-content;
      }
      .status-pill {
        border-color: transparent;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
      }
      .status-icon {
        flex-shrink: 0;
        border-radius: 0;
        width: auto;
        height: auto;
        min-width: 25px;
        min-height: 25px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .status-icon > svg {
        width: 16px;
        height: 16px;
      }
      .status-label-text {
        font-size: var(--boxel-font-xs);
        font-weight: 600;
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-xxs);
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}
