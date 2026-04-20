import WorldWwwIcon from '@cardstack/boxel-icons/world-www';
import UrlField from './url';
import { Component } from './card-api';
import { EntityDisplayWithIcon } from '@cardstack/boxel-ui/components';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import { markdownLink } from './markdown-helpers';

const domainWithPath = (urlString: string | null) => {
  if (!urlString) {
    return '';
  }

  const url = new URL(urlString);
  return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
};

export default class WebsiteField extends UrlField {
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

  // CS-10786: show `[domain/path](full-url)` for valid URLs — the atom/
  // embedded templates hide the scheme for readability, and we preserve that
  // choice for markdown output too. Invalid URLs fall back to escaped text.
  static markdown = class Markdown extends Component<typeof WebsiteField> {
    get text() {
      let value = this.args.model;
      if (value == null || value === '') {
        return '';
      }
      if (isValidUrl(value)) {
        return markdownLink(domainWithPath(value), value);
      }
      return markdownEscape(value);
    }
    <template>{{this.text}}</template>
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
