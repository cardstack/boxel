import { type TestContext, getContext } from '@ember/test-helpers';

import { baseRealm } from '@cardstack/runtime-common';

import type LoaderService from '@cardstack/host/services/loader-service';

import type * as CardAPIModule from 'https://cardstack.com/base/card-api';
import type * as NumberFieldModule from 'https://cardstack.com/base/number';
import type * as StringFieldModule from 'https://cardstack.com/base/string';

let _string: (typeof StringFieldModule)['default'];
let _number: (typeof NumberFieldModule)['default'];
let field: (typeof CardAPIModule)['field'];
let CardDef: (typeof CardAPIModule)['CardDef'];
let Component: (typeof CardAPIModule)['Component'];
let FieldDef: (typeof CardAPIModule)['FieldDef'];
let contains: (typeof CardAPIModule)['contains'];
let containsMany: (typeof CardAPIModule)['containsMany'];
let linksTo: (typeof CardAPIModule)['linksTo'];
let linksToMany: (typeof CardAPIModule)['linksToMany'];

let recompute: (typeof CardAPIModule)['recompute'];

let didInit = false;

async function initialize() {
  if (didInit) {
    return;
  }
  let owner = (getContext() as TestContext).owner;
  let loader = (owner.lookup('service:loader-service') as LoaderService).loader;

  _string = (
    await loader.import<typeof StringFieldModule>(`${baseRealm.url}string`)
  ).default;

  _number = (
    await loader.import<typeof NumberFieldModule>(`${baseRealm.url}number`)
  ).default;

  let cardAPI = await loader.import<typeof CardAPIModule>(
    `${baseRealm.url}card-api`,
  );

  ({
    field,
    CardDef,
    Component,
    FieldDef,
    contains,
    containsMany,
    linksTo,
    linksToMany,
    recompute,
  } = cardAPI);

  didInit = true;
}

export async function setupBaseRealm(hooks: NestedHooks) {
  hooks.beforeEach(initialize);
}

export {
  _string as StringField,
  _number as NumberField,
  field,
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  recompute,
};
