import GlimmerComponent from '@glimmer/component';
import { ProgressBar } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';

interface CrmProgressBarArgs {
  Args: {
    value: number;
    max: number;
    color: string;
  };
  Element: HTMLElement;
}

class CrmProgressBar extends GlimmerComponent<CrmProgressBarArgs> {
  get progressBarStyle() {
    return htmlSafe(`--boxel-progress-bar-fill-color: ${this.args.color};`);
  }

  <template>
    <ProgressBar
      @value={{@value}}
      @max={{@max}}
      style={{this.progressBarStyle}}
      class='progress-bar'
      ...attributes
    />
    <style scoped>
      .progress-bar {
        width: 100px;
        --boxel-progress-bar-background-color: var(--boxel-100);
        --boxel-progress-bar-border-radius: 50px;
      }
      .progress-bar :deep(.progress-bar-container) {
        height: 1.2em;
        border: 1px solid var(--boxel-300);
      }
    </style>
  </template>
}

export default CrmProgressBar;
