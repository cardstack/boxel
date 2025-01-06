import WorldWwwIcon from '@cardstack/boxel-icons/world-www';
import { UrlField } from './url';
import { Component } from 'https://cardstack.com/base/card-api';
import EntityDisplayWithIcon from './components/entity-icon-display';

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
      <EntityDisplayWithIcon @title={{domainWithPath @model}}>
        <:icon>
          <WorldWwwIcon />
        </:icon>
      </EntityDisplayWithIcon>
    </template>
  };

  static embedded = class Embedded extends Component<typeof WebsiteField> {
    <template>
      {{domainWithPath @model}}
    </template>
  };
}
