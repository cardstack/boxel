// Pretui — StatusChip: a Chip whose hue is derived from its status value, stable across cards.
import Component from '@glimmer/component';
import { Chip } from './chip';
import { statusHue } from '../internal/ink';

export interface StatusChipSignature {
  Args: { value: string; hue?: string };
  Element: HTMLSpanElement;
}

// A chip whose hue derives from the status VALUE — caller override is the exception.
export class StatusChip extends Component<StatusChipSignature> {
  get hue() {
    return this.args.hue ?? statusHue(this.args.value);
  }
  <template>
    <Chip @label={{@value}} @hue={{this.hue}} data-test-pretui-status-chip ...attributes />
  </template>
}
