import { type RealmInfo } from '@cardstack/runtime-common';
import { DefaultAtomViewTemplate } from './-components/default-atom';
import { isSavedInstance, realmInfo, realmURL } from './-constants';
import { field } from './-fields/decorator';
import { type BaseDefComponent } from './-components/utils';
import { getDataBucket } from './-fields/storage';
import { MissingEmbeddedTemplate } from './-components/missing-embedded';
import { DefaultCardDefTemplate } from './-components/default-card';
import { contains } from './-fields/contains';
import { IDField } from './-fields/id';
import { StringField } from './-fields/string';
import { MaybeBase64Field } from './-fields/maybe-base-64';
import { BaseDef } from '../card-api';

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
