'use strict';

const { PREFIX_REALM_PREFIXES } = require('../../../lib/utils/prefix-realms');

describe('prefix-realms', () => {
  it('lists the prefixes runtime-common declares, in its order', async () => {
    let { PREFIX_REALM_PREFIXES: declared } =
      await import('../../../../runtime-common/realm-prefixes.ts');
    expect([...PREFIX_REALM_PREFIXES]).toEqual([...declared]);
  });
});
