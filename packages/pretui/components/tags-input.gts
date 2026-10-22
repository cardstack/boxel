// Pretui — TagsInput: the Mantine name and argument spellings for TokenInput.
import Component from '@glimmer/component';
import { TokenInput } from './token-input';

export interface TagsInputSignature {
  Args: {
    value?: readonly string[];
    defaultValue?: readonly string[];
    onChange?: (next: string[]) => void;
    /** Alias of `@onChange` — the kit's control spelling. */
    onValueChange?: (next: string[]) => void;
    label?: string;
    placeholder?: string;
    max?: number;
    /** Mantine's `allowDuplicates`, TokenInput's `@allowDuplicates`. */
    duplicates?: boolean;
    /** Mantine's `splitChars`: characters that commit besides Enter (default [',']). */
    separators?: readonly string[];
    disabled?: boolean;
  };
  Element: HTMLDivElement;
}

/**
 * TagsInput is TokenInput under the name Mantine and Chakra agents type, the
 * way Modal is Dialog. It adds no behaviour of its own: the chips, the
 * commit and remove paths, the case-insensitive dedupe, the announcements
 * and the readonly-at-the-cap all live in TokenInput, so there is one tag
 * row in the kit, not two that drift apart. This file only maps the Mantine
 * spellings (`duplicates`, `separators`, `onValueChange`) onto it.
 */
export class TagsInput extends Component<TagsInputSignature> {
  change = (next: string[]) => {
    this.args.onChange?.(next);
    this.args.onValueChange?.(next);
  };
  <template>
    <TokenInput
      @value={{@value}}
      @defaultValue={{@defaultValue}}
      @label={{@label}}
      @placeholder={{@placeholder}}
      @max={{@max}}
      @allowDuplicates={{@duplicates}}
      @separators={{@separators}}
      @disabled={{@disabled}}
      @onChange={{this.change}}
      data-test-pretui-tags-input
      ...attributes
    />
  </template>
}
