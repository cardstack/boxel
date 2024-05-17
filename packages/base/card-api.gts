import {
  CardContextName,
  isField,
  primitive,
  isCardInstance as _isCardInstance,
} from '@cardstack/runtime-common';

import {
  // intentionally not exporting this so that the outside world
  // cannot mark a card as being saved
  isSavedInstance,
  formats,
  type Format,
  type FieldType,
  type JSONAPISingleResourceDocument,
  serialize,
  deserialize,
  useIndexBasedKey,
  fieldDecorator,
  fieldType,
  queryableValue,
  formatQuery,
  relativeTo,
  realmInfo,
  realmURL,
} from './card-api/-constants';
import {
  BaseDef,
  getComponent,
  type BaseDefConstructor,
  type BaseInstanceType,
} from './card-api/-base-def';
import { CardDef } from './card-api/-card-def';
import {
  Component,
  type CardContext,
  type SignatureFor,
  type FieldsTypeFor,
} from './card-api/-components/utils';
import {
  Field,
  getFields,
  getIfReady,
  recompute,
  type SerializeOpts,
} from './card-api/-fields/storage';
import { type BoxComponent } from './card-api/-components/field-component';
import { FieldDef } from './card-api/-field-def';
import {
  formatQueryValue,
  getQueryableValue,
  searchDoc,
} from './card-api/-query-support';
import {
  LoaderType,
  createFromSerialized,
  relationshipMeta,
  serializeCard,
  updateFromSerialized,
} from './card-api/-serialization';
import { flushLogs } from './card-api/-logger';
import { StringField } from './card-api/-fields/string';
import { field, getFieldDescription } from './card-api/-fields/decorator';
import { contains } from './card-api/-fields/contains';
import { containsMany } from './card-api/-fields/contains-many';
import { linksTo } from './card-api/-fields/links-to';
import { linksToMany } from './card-api/-fields/links-to-many';
import { isCard } from './card-api/-type-utils';
import {
  subscribeToChanges,
  unsubscribeFromChanges,
} from './card-api/-subscriptions';
import { IdentityContext } from './card-api/-identity-context';
import { MaybeBase64Field } from './card-api/-fields/maybe-base-64';

export {
  BaseDef,
  CardDef,
  Component,
  contains,
  containsMany,
  createFromSerialized,
  deserialize,
  field,
  fieldDecorator,
  FieldDef,
  fieldType,
  flushLogs,
  formatQuery,
  formatQueryValue,
  formats,
  getComponent,
  getFieldDescription,
  getFields,
  getIfReady,
  getQueryableValue,
  IdentityContext,
  isCard,
  isField,
  linksTo,
  linksToMany,
  MaybeBase64Field,
  primitive,
  queryableValue,
  realmInfo,
  realmURL,
  recompute,
  relationshipMeta,
  relativeTo,
  searchDoc,
  serialize,
  serializeCard,
  StringField,
  subscribeToChanges,
  unsubscribeFromChanges,
  updateFromSerialized,
  useIndexBasedKey,
  type BaseDefConstructor,
  type BaseInstanceType,
  type BoxComponent,
  type Field,
  type FieldsTypeFor,
  type FieldType,
  type Format,
  type JSONAPISingleResourceDocument,
  type LoaderType,
  type SerializeOpts,
  type SignatureFor,
};

export function isSaved(instance: CardDef): boolean {
  return instance[isSavedInstance] === true;
}

export function setCardAsSavedForTest(instance: CardDef): void {
  instance[isSavedInstance] = true;
}

declare module 'ember-provide-consume-context/context-registry' {
  export default interface ContextRegistry {
    [CardContextName]: CardContext;
  }
}
