// Pretui — StatusChip: a Chip whose hue is derived from its status value, stable across cards.
import Component from '@glimmer/component';
import { Chip } from './chip';
import { statusHue } from '../internal/ink';
import {
  PRETUI_TONES,
  resolveTone,
  type PretuiToneArg,
} from '../pretui-primitives';

export interface StatusChipSignature {
  Args: { value: string; hue?: string; tone?: PretuiToneArg };
  Element: HTMLSpanElement;
}

// A chip whose hue derives from the status VALUE — caller override is the exception.
export class StatusChip extends Component<StatusChipSignature> {
  get hue() {
    return this.args.hue ?? statusHue(this.args.value);
  }
  // a toned chip's dot takes its tone unless @hue says otherwise; neutral,
  // passed or defaulted, keeps the status hue
  get dotHue() {
    return resolveTone(this.args.tone, PRETUI_TONES, 'neutral') === 'neutral'
      ? this.hue
      : this.args.hue;
  }
  <template>
    <Chip
      @label={{@value}}
      @hue={{this.dotHue}}
      @tone={{@tone}}
      data-test-pretui-status-chip
      ...attributes
    />
  </template>
}
