import { Component } from 'https://cardstack.com/base/card-api';
import TagCard from 'https://cardstack.com/base/tag';

import { BoxelTag } from '@cardstack/boxel-ui/components';
import { getContrastColor } from '@cardstack/boxel-ui/helpers';

class ViewTemplate extends Component<typeof Tag> {
  <template>
    <BoxelTag
      @name='# {{@model.name}}'
      @pillColor={{@model.color}}
      @fontColor={{this.fontColor}}
      @ellipsize={{true}}
      @borderColor='none'
    />
  </template>
  private get fontColor() {
    if (this.args.model.fontColor) {
      return this.args.model.fontColor;
    }
    if (this.args.model.color) {
      return getContrastColor(this.args.model.color, undefined, undefined, {
        isSmallText: true,
      });
    }
    return 'var(--boxel-400)';
  }
}

export class Tag extends TagCard {
  static atom = ViewTemplate;
  static embedded = ViewTemplate;
}
