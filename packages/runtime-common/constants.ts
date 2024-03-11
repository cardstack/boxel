import { RealmPaths } from './paths';
import type { ResolvedCodeRef } from './code-ref';

export const baseRealm = new RealmPaths('https://cardstack.com/base/');

export const catalogEntryRef: ResolvedCodeRef = {
  module: `${baseRealm.url}catalog-entry`,
  name: 'CatalogEntry',
};
export const baseCardRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api`,
  name: 'CardDef',
};
export const baseFieldRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api`,
  name: 'FieldDef',
};

export const isField = Symbol('cardstack-field');

export const aiBotUsername = 'aibot';
