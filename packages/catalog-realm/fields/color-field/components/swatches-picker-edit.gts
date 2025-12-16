import Component from '@glimmer/component';
import type { ColorFieldConfiguration } from '../util/color-utils';
import { not } from '@cardstack/boxel-ui/helpers';
import { ColorPalette } from '@cardstack/boxel-ui/components';
import type { ColorFieldSignature } from '../util/colorfieldsignature';

export default class SwatchesPickerEdit extends Component<ColorFieldSignature> {
  get paletteColors() {
    const options = (this.args.configuration as ColorFieldConfiguration & {
      variant: 'swatches-picker';
    })?.options;
    return options?.paletteColors;
  }

  <template>
    <ColorPalette
      @color={{@model}}
      @onChange={{@set}}
      @disabled={{not @canEdit}}
      @paletteColors={{this.paletteColors}}
    />
  </template>
}
