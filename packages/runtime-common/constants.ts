import { RealmPaths } from './paths';
import type { CodeRef } from './code-ref';

export const baseRealm = new RealmPaths('https://cardstack.com/base/');

export const catalogEntryRef: CodeRef = {
  module: `${baseRealm.url}catalog-entry`,
  name: 'CatalogEntry',
};
export const baseCardRef: CodeRef = {
  module: `${baseRealm.url}card-api`,
  name: 'CardDef',
};

export const isField = Symbol('cardstack-field');
export const primitive = Symbol('cardstack-primitive');
