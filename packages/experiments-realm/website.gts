import WorldWwwIcon from '@cardstack/boxel-icons/world-www';
import { UrlField } from './url';
import { Component } from 'https://cardstack.com/base/card-api';
import { EntityDisplay } from './components/entity-display';

export class WebsiteField extends UrlField {
  static icon = WorldWwwIcon;
  static displayName = 'Website';

  static atom = class Atom extends Component<typeof this> {
    <template>
      <EntityDisplay @name={{@model}}>
        <:thumbnail>
          <WorldWwwIcon />
        </:thumbnail>
      </EntityDisplay>
    </template>
  };
}
