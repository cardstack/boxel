import Component from '@glimmer/component';

import {
  fittedFormatById,
  fittedFormatIds,
  sanitizeHtmlSafe,
  type FittedFormatId,
} from '../../helpers.ts';

interface Signature {
  Args: {
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
    let formatSpec = this.formatSpec;

    if (!formatSpec) {
      return sanitizeHtmlSafe('');
    }

    return sanitizeHtmlSafe(
      `width: ${formatSpec.width}px; height: ${formatSpec.height}px;`,
    );
  }
}
