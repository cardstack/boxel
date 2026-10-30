'use strict';

const {
  canonicalizeModuleSpecifier,
  modulesAreEquivalent,
} = require('../../../lib/utils/import-utils');

describe('import-utils', () => {
  it('folds each aliased prefix onto the alias runtime-common declares', async () => {
    let { PREFIX_REALMS } =
      await import('../../../../runtime-common/realm-prefixes.ts');
    for (let { prefix, alias } of PREFIX_REALMS) {
      let specifier = `${prefix}card-api`;
      if (alias) {
        expect(canonicalizeModuleSpecifier(specifier)).toBe(`${alias}card-api`);
        expect(modulesAreEquivalent(specifier, `${alias}card-api`)).toBe(true);
      } else {
        expect(canonicalizeModuleSpecifier(specifier)).toBe(specifier);
      }
    }
  });

  it('leaves specifiers outside the prefix realms alone', () => {
    expect(canonicalizeModuleSpecifier('@cardstack/boxel-ui/components')).toBe(
      '@cardstack/boxel-ui/components',
    );
    expect(modulesAreEquivalent('@cardstack/base/card-api', 'ember')).toBe(
      false,
    );
  });
});
