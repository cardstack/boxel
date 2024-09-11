import {
  contains,
  field,
  Component,
  CardDef,
  relativeTo,
  realmInfo,
  containsMany,
  linksTo,
} from './card-api';
import StringField from './string';
import CodeRef from './code-ref';

import GlimmerComponent from '@glimmer/component';
import MarkdownField from './markdown';
import { Base64ImageCard } from './base64-image-card';
import BooleanField from './boolean';

class BoxelSpecType extends StringField {
  types = ['card', 'field', 'command', 'component'];
}

// The point of this is so we can search for icon card
export class IconCard extends CardDef {
  @field name = contains(StringField);
  @field icon = linksTo(Base64ImageCard);
  @field keywords = containsMany(StringField); //so i can search via keyword

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      {{@model.name}}
      {{@fields.icon}}
    </template>
  };
}

export class CatalogEntry extends CardDef {
  static displayName = 'Catalog Entry';
  @field ref = contains(CodeRef);

  @field name = contains(StringField);
  @field tagLine = contains(StringField);
  @field readme = contains(MarkdownField);

  @field type = contains(BoxelSpecType);
  @field isField = contains(BooleanField);

  @field moduleHref = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      return new URL(this.ref.module, this[relativeTo]).href;
    },
  });
  @field realmName = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      return this[realmInfo]?.name;
    },
  });
  @field icon = linksTo(IconCard);

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <CatalogEntryContainer class='fitted'>
        <header class='title'>
          <@fields.title />
        </header>
        <p class='description' data-test-description>
          <@fields.description />
        </p>
      </CatalogEntryContainer>
      <style scoped>
        .fitted > * {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .title {
          font: 700 var(--boxel-font-sm);
        }

        .description {
          margin: 0;
          color: var(--boxel-500);
          font-size: var(--boxel-font-size-xs);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CatalogEntryContainer class='container'>
        <h1 data-test-title><@fields.title /></h1>
        <em data-test-description><@fields.description /></em>
        <div data-test-ref>
          Module:
          <@fields.moduleHref />
          Name:
          {{@model.ref.name}}
        </div>
        <div class='realm-name' data-test-realm-name>
          in
          <@fields.realmName />
        </div>
      </CatalogEntryContainer>
      <style scoped>
        .container {
          padding: var(--boxel-sp);
        }
        .realm-name {
          color: var(--boxel-teal);
          font-size: var(--boxel-font-size-xs);
        }
      </style>
    </template>
  };
}

interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

class CatalogEntryContainer extends GlimmerComponent<Signature> {
  <template>
    <div class='entry' ...attributes>
      {{yield}}
    </div>
    <style scoped>
      .entry {
        display: grid;
        gap: 3px;
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
