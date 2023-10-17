import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
  BaseDef,
  primitive,
  relativeTo,
  realmInfo,
} from './card-api';
import StringField from './string';
import BooleanField from './boolean';
import CodeRef from './code-ref';
import {
  baseCardRef,
  isFieldDef,
  loadCard,
  Loader,
} from '@cardstack/runtime-common';
import { isEqual } from 'lodash';
import { FieldContainer } from '@cardstack/boxel-ui';
import GlimmerComponent from '@glimmer/component';

export class CatalogEntry extends CardDef {
  static displayName = 'Catalog Entry';
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field ref = contains(CodeRef);
  @field isPrimitive = contains(BooleanField, {
    computeVia: async function (this: CatalogEntry) {
      let loader = Loader.getLoaderFor(Object.getPrototypeOf(this).constructor);

      if (!loader) {
        throw new Error(
          'Could not find a loader for this instance’s class’s module',
        );
      }

      let card: typeof BaseDef | undefined = await loadCard(this.ref, {
        loader,
        relativeTo: this[relativeTo],
      });
      if (!card) {
        throw new Error(`Could not load card '${this.ref.name}'`);
      }
      // the base card is a special case where it is technically not a primitive, but because it has no fields
      // it is not useful to treat as a composite card (for the purposes of creating new card instances).
      return primitive in card || isEqual(baseCardRef, this.ref);
    },
  });
  // If it's not a field, then it's a card
  @field isField = contains(BooleanField, {
    computeVia: async function (this: CatalogEntry) {
      let loader = Loader.getLoaderFor(Object.getPrototypeOf(this).constructor);

      if (!loader) {
        throw new Error(
          'Could not find a loader for this instance’s class’s module',
        );
      }

      let card: typeof BaseDef | undefined = await loadCard(this.ref, {
        loader,
        relativeTo: this[relativeTo],
      });
      if (!card) {
        throw new Error(`Could not load card '${this.ref.name}'`);
      }

      return isFieldDef(card);
    },
  });
  @field moduleHref = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      return new URL(this.ref.module, this[relativeTo]).href;
    },
  });
  @field demo = contains(FieldDef);
  @field realmName = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      return this[realmInfo]?.name;
    },
  });
  @field thumbnailURL = contains(StringField, { computeVia: () => null }); // remove this if we want card type entries to have images

  get showDemo() {
    return !this.isPrimitive;
  }

  // An explicit edit template is provided since computed isPrimitive bool
  // field (which renders in the embedded format) looks a little wonky
  // right now in the edit view.
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CatalogEntryContainer>
        <FieldContainer @tag='label' @label='Title' data-test-field='title'>
          <@fields.title />
        </FieldContainer>
        <FieldContainer
          @tag='label'
          @label='Description'
          data-test-field='description'
        >
          <@fields.description />
        </FieldContainer>
        <FieldContainer @label='Ref' data-test-field='ref'>
          <@fields.ref />
        </FieldContainer>
        <FieldContainer @label='Realm Name' data-test-field='realmName'>
          <@fields.realmName />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Demo' data-test-field='demo'>
          <@fields.demo />
        </FieldContainer>
      </CatalogEntryContainer>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CatalogEntryContainer class='embedded'>
        <header class='title'>
          <@fields.title />
        </header>
        <p class='description' data-test-description>
          <@fields.description />
        </p>
      </CatalogEntryContainer>
      <style>
        .embedded > * {
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
      <CatalogEntryContainer>
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
        {{#if @model.showDemo}}
          <div data-test-demo><@fields.demo /></div>
        {{/if}}
      </CatalogEntryContainer>
      <style>
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
    <style>
      .entry {
        display: grid;
        gap: 3px;
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
