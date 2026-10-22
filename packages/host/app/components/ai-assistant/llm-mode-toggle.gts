import Component from '@glimmer/component';

import { SegmentedControl } from '@cardstack/pretui/components/segmented-control';

import type { LLMMode } from '@cardstack/runtime-common/matrix-constants';

interface Signature {
  Args: {
    selected: LLMMode;
    onChange: (mode: LLMMode) => void;
    disabled?: boolean;
    onExpand?: () => void;
    onCollapse?: () => void;
  };
  Element: HTMLElement;
}

const MODES = [
  { value: 'ask', label: 'Ask' },
  { value: 'act', label: 'Act' },
];

// Ask or Act, as Pret UI's SegmentedControl: the chosen side is a white face
// that slides between the two, never teal, which is spent on Send.
export default class LLMModeToggle extends Component<Signature> {
  private get selected(): LLMMode {
    return this.args.selected === 'act' ? 'act' : 'ask';
  }

  private change = (mode: string) => {
    if (mode !== this.selected) {
      this.args.onChange(mode as LLMMode);
    }
  };

  <template>
    <div class='llm-mode-toggle' ...attributes>
      <SegmentedControl
        @label='Assistant mode'
        @options={{MODES}}
        @value={{this.selected}}
        @onValueChange={{this.change}}
        @disabled={{@disabled}}
        title='Ask answers without changing anything. Act applies changes and runs commands.'
        data-test-llm-mode-toggle
      />
    </div>
    <style scoped>
      /* the composer's well and the white face it had */
      /* the kit's control at the kit's size: it scales from its own font
         size, so the composer's reading size must not reach it */
      .llm-mode-toggle {
        display: flex;
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        --inset: var(--ai-composer-well, var(--boxel-200));
        --card: var(--boxel-light);
        --card-foreground: var(--boxel-dark);
        --muted-foreground: var(--boxel-500);
        --border: transparent;
        --border-strong: transparent;
        --pretui-highlight-pill: var(--boxel-light);
        --pretui-seg-active-ink: var(--boxel-dark);
      }
    </style>
  </template>
}
