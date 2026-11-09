import { describe, it, expect } from 'vitest';
import { PrefixRealmNetwork } from '@cardstack/runtime-common/prefix-realm-network';
import {
  extractImportSpecifiers,
  extractExportedClassNames,
  extractRelationshipLinks,
  realmRelativePath,
  resolveSameRealmFile,
} from '../../src/commands/realm/ingest-card.js';

describe('ingest-card helpers', () => {
  describe('extractRelationshipLinks', () => {
    it('collects linksToMany (field.N) + linksTo self URLs, skipping nulls', () => {
      let src = JSON.stringify({
        data: {
          relationships: {
            'bottles.0': { links: { self: '../WineBottle/a' } },
            'bottles.1': { links: { self: '../WineBottle/b' } },
            label: { links: { self: '../Image/x' } },
          },
        },
      });
      expect(new Set(extractRelationshipLinks(src))).toEqual(
        new Set(['../WineBottle/a', '../WineBottle/b', '../Image/x']),
      );
    });

    it('returns [] for no relationships or invalid JSON', () => {
      expect(extractRelationshipLinks('{"data":{}}')).toEqual([]);
      expect(extractRelationshipLinks('not json')).toEqual([]);
    });
  });

  describe('extractImportSpecifiers', () => {
    it('captures value, type, namespace, re-export, and side-effect imports', () => {
      let src = `
        import { contains, field } from '@cardstack/base/card-api';
        import type { MortgageCalculator } from '../mortgage-calculator';
        import * as utils from './components/utils';
        export { Foo } from './foo';
        import './side-effect';
        import StringField from '@cardstack/base/string';
      `;
      expect(new Set(extractImportSpecifiers(src))).toEqual(
        new Set([
          '@cardstack/base/card-api',
          '../mortgage-calculator',
          './components/utils',
          './foo',
          './side-effect',
          '@cardstack/base/string',
        ]),
      );
    });

    it('includes type-only imports (erased at transpile, still needed on disk)', () => {
      let specs = extractImportSpecifiers(
        `import type { X } from './x';\nimport Y from './y';`,
      );
      expect(specs).toContain('./x');
      expect(specs).toContain('./y');
    });
  });

  describe('extractExportedClassNames', () => {
    it('finds exported card/field classes, including default and abstract', () => {
      let src = `
        class Hidden extends FieldDef {}
        export class MortgageCalculator extends CardDef {}
        export default class Widget extends FieldDef {}
        export abstract class Base extends CardDef {}
      `;
      let names = extractExportedClassNames(src);
      expect(names).toContain('MortgageCalculator');
      expect(names).toContain('Widget');
      expect(names).toContain('Base');
      expect(names).not.toContain('Hidden'); // not exported
    });
  });

  describe('realmRelativePath', () => {
    let realmRoot = 'https://localhost:4201/catalog/';
    let network = new PrefixRealmNetwork({ '@cardstack/catalog/': realmRoot });

    it('gives the same path for either form of an identifier', () => {
      expect(
        realmRelativePath('@cardstack/catalog/Spec/foo', realmRoot, network),
      ).toBe('Spec/foo');
      expect(
        realmRelativePath(`${realmRoot}Spec/foo`, realmRoot, network),
      ).toBe('Spec/foo');
    });

    it('returns null outside the realm and for what does not resolve', () => {
      expect(
        realmRelativePath(
          'https://localhost:4201/other/Spec/foo',
          realmRoot,
          network,
        ),
      ).toBeNull();
      expect(
        realmRelativePath('@glimmer/component', realmRoot, network),
      ).toBeNull();
    });
  });

  describe('resolveSameRealmFile', () => {
    let realmRoot = 'https://localhost:4201/catalog/';
    let fromAbs =
      'https://localhost:4201/catalog/04868f-mortgage-calculator/components/isolated-template.gts';
    let fileSet = new Set([
      '04868f-mortgage-calculator/mortgage-calculator.gts',
      '04868f-mortgage-calculator/components/utils.gts',
    ]);
    let network = new PrefixRealmNetwork({
      '@cardstack/base/': 'https://localhost:4201/base/',
      '@cardstack/catalog/': realmRoot,
      '@cardstack/skills/': 'https://localhost:4201/skills/',
    });

    it('resolves a relative import to an existing same-realm .gts file', () => {
      expect(
        resolveSameRealmFile(
          '../mortgage-calculator',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBe('04868f-mortgage-calculator/mortgage-calculator.gts');
      expect(
        resolveSameRealmFile('./utils', fromAbs, realmRoot, fileSet, network),
      ).toBe('04868f-mortgage-calculator/components/utils.gts');
    });

    it('returns null for base-realm and bare (npm) imports', () => {
      expect(
        resolveSameRealmFile(
          'https://cardstack.com/base/string',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBeNull();
      expect(
        resolveSameRealmFile(
          '@cardstack/base/string',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBeNull();
      expect(
        resolveSameRealmFile(
          '@glimmer/component',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBeNull();
    });

    it('matches a file whose name the import percent-encodes', () => {
      expect(
        resolveSameRealmFile(
          './my%20utils',
          fromAbs,
          realmRoot,
          new Set(['04868f-mortgage-calculator/components/my utils.gts']),
          network,
        ),
      ).toBe('04868f-mortgage-calculator/components/my utils.gts');
    });

    it('returns null when the same-realm file is not present', () => {
      expect(
        resolveSameRealmFile('./missing', fromAbs, realmRoot, fileSet, network),
      ).toBeNull();
    });

    it('resolves registered-prefix (@cardstack/<realm>/…) same-realm imports', () => {
      expect(
        resolveSameRealmFile(
          '@cardstack/catalog/04868f-mortgage-calculator/mortgage-calculator',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBe('04868f-mortgage-calculator/mortgage-calculator.gts');
    });

    it('resolves a prefix to wherever the server serves its realm', () => {
      let servedElsewhere = 'https://realms.example.test/published/v2/';
      expect(
        resolveSameRealmFile(
          '@cardstack/catalog/04868f-mortgage-calculator/mortgage-calculator',
          `${servedElsewhere}04868f-mortgage-calculator/components/isolated-template.gts`,
          servedElsewhere,
          fileSet,
          new PrefixRealmNetwork({ '@cardstack/catalog/': servedElsewhere }),
        ),
      ).toBe('04868f-mortgage-calculator/mortgage-calculator.gts');
    });

    it("does not match another realm's identifier that contains this realm's name", () => {
      expect(
        resolveSameRealmFile(
          '@cardstack/base/catalog/04868f-mortgage-calculator/mortgage-calculator',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBeNull();
    });

    it('returns null for an unregistered prefix', () => {
      expect(
        resolveSameRealmFile(
          '@cardstack/unknown/04868f-mortgage-calculator/mortgage-calculator',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBeNull();
    });

    it('returns null for prefix imports that point at another realm', () => {
      // Another registered realm's prefix resolves outside this realm.
      expect(
        resolveSameRealmFile(
          '@cardstack/skills/foo',
          fromAbs,
          realmRoot,
          fileSet,
          network,
        ),
      ).toBeNull();
    });
  });
});
