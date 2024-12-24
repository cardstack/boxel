import WorldWwwIcon from '@cardstack/boxel-icons/world-www';
import { UrlField } from './url';
import { Component } from 'https://cardstack.com/base/card-api';
import { EntityDisplay } from './components/entity-display';

const domainWithPath = (urlString: string | null) => {
  if (!urlString) {
    return '';
  }

  const url = new URL(urlString);
  return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
};

export class WebsiteField extends UrlField {
  static icon = WorldWwwIcon;
  static displayName = 'Website';

  static atom = class Atom extends Component<typeof WebsiteField> {
    <template>
      <EntityDisplay>
        <:title>
          {{domainWithPath @model}}
        </:title>
        <:icon>
          <WorldWwwIcon />
        </:icon>
      </EntityDisplay>
    </template>
  };

  static embedded = class Embedded extends Component<typeof WebsiteField> {
    <template>
      {{domainWithPath @model}}
    </template>
  };
}
