import Component from '@glimmer/component';

import {
  type FittedFormatId,
  fittedFormatById,
  fittedFormatIds,
  sanitizeHtmlSafe,
} from '../../helpers.ts';

interface Signature {
  Args: {
    fullWidth?: boolean;
    size?: FittedFormatId;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export default class FittedCardContainer extends Component<Signature> {
  <template>
    <div
      class='boxel-fitted-card-container'
      style={{this.containerStyle}}
      ...attributes
    >
      {{yield}}
    </div>
  </template>

  get formatSpec() {
    let size = this.args.size;

    if (!size) {
      return null;
    }

    if (!fittedFormatIds?.includes(size)) {
      console.error(
        `Size "${size}" does not exist in fitted format sizes. Please choose from ${fittedFormatIds.join(', ')}`,
      );
      return null;
    }

    return fittedFormatById.get(size) ?? null;
  }

  get containerStyle() {
    let style = ``;
    let formatSpec = this.formatSpec;

    if (!formatSpec) {
      return sanitizeHtmlSafe(style);
    }

    if (this.args.fullWidth) {
      style += `width: 100%; height: ${formatSpec.height}px;`;
    } else {
      style += `width: ${formatSpec.width}px; height: ${formatSpec.height}px;`;
    }

    return sanitizeHtmlSafe(style);
  }
}
