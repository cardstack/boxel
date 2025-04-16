import WorldWwwIcon from '@cardstack/boxel-icons/world-www';
import { UrlField } from './url';
import { Component } from './card-api';
import { EntityDisplayWithIcon } from '@cardstack/boxel-ui/components';

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
      <EntityDisplayWithIcon>
        <:title>
          {{! Display only domain and path, unlike URLField's full URL representation }}
          {{! Custom atom implementation for handling URL interactions }}
          {{#if @model}}
            {{#if (isValidUrl @model)}}
              <a href={{@model}} target='_blank' rel='noopener noreferrer'>
                {{domainWithPath @model}}
              </a>
            {{else}}
              Invalid URL
            {{/if}}
          {{/if}}
        </:title>
        <:icon>
          <WorldWwwIcon />
        </:icon>
      </EntityDisplayWithIcon>
      <style scoped>
        a:hover {
          text-decoration: underline;
          color: inherit;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof WebsiteField> {
    <template>
      {{#if @model}}
        {{#if (isValidUrl @model)}}
          <a href={{@model}} target='_blank' rel='noopener noreferrer'>
            {{domainWithPath @model}}
          </a>
        {{else}}
          Invalid URL
        {{/if}}
      {{/if}}
      <style scoped>
        a:hover {
          text-decoration: underline;
          color: inherit;
        }
      </style>
    </template>
  };
}

function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch (err) {
    return false;
  }
}
