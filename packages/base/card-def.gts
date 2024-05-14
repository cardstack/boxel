import { BaseDef, type BaseDefComponent } from 'base-def';
import { DefaultAtomViewTemplate } from 'default-atom-view';
import GlimmerComponent from '@glimmer/component';
import { contains, field } from 'field-decorator';
import { MissingEmbeddedTemplate } from 'missing-embedded';
import { StringField } from 'string';
import { isSavedInstance } from 'utils';
import { Format } from '@cardstack/runtime-common';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
    format: Format;
  };
}> {
  <template>
    <div class={{cn 'default-card-template' @format}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <FieldContainer
            {{! @glint-ignore (glint is arriving at an incorrect type signature for 'startCase') }}
            @label={{startCase key}}
            data-test-field={{key}}
          >
            <Field />
          </FieldContainer>
        {{/unless}}
      {{/each-in}}
    </div>
    <style>
      .default-card-template {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
      .default-card-template.edit {
        padding-right: var(
          --boxel-sp-xxl
        ); /* allow room for trash/delete icons that appear on hover */
      }
    </style>
  </template>
}
export class CardDef extends BaseDef {
  [isSavedInstance] = false;
  [realmInfo]: RealmInfo | undefined = undefined;
  [realmURL]: URL | undefined = undefined;
  @field id = contains(IDField);
  @field title = contains(StringField);
  @field description = contains(StringField);
  // TODO: this will probably be an image or image url field card when we have it
  // UPDATE: we now have a Base64ImageField card. we can probably refactor this
  // to use it directly now (or wait until a better image field comes along)
  @field thumbnailURL = contains(MaybeBase64Field);
  static displayName = 'Card';
  static isCardDef = true;

  static assignInitialFieldValue(
    instance: BaseDef,
    fieldName: string,
    value: any,
  ) {
    if (fieldName === 'id') {
      // we need to be careful that we don't trigger the ambient recompute() in our setters
      // when we are instantiating an instance that is placed in the identityMap that has
      // not had it's field values set yet, as computeds will be run that may assume dependent
      // fields are available when they are not (e.g. CatalogEntry.isPrimitive trying to load
      // it's 'ref' field). In this scenario, only the 'id' field is available. the rest of the fields
      // will be filled in later, so just set the 'id' directly in the deserialized cache to avoid
      // triggering the recompute.
      let deserialized = getDataBucket(instance);
      deserialized.set('id', value);
    } else {
      super.assignInitialFieldValue(instance, fieldName, value);
    }
  }

  static embedded: BaseDefComponent = MissingEmbeddedTemplate;
  static isolated: BaseDefComponent = DefaultCardDefTemplate;
  static edit: BaseDefComponent = DefaultCardDefTemplate;
  static atom: BaseDefComponent = DefaultAtomViewTemplate;
}

export type CardDefConstructor = typeof CardDef;
