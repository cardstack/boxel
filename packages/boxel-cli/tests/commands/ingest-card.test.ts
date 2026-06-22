import { describe, it, expect } from 'vitest';
import {
  extractImportSpecifiers,
  extractExportedClassNames,
  extractRelationshipLinks,
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
            'cardInfo.theme': { links: { self: null } },
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
        import { contains, field } from 'https://cardstack.com/base/card-api';
        import type { MortgageCalculator } from '../mortgage-calculator';
        import * as utils from './components/utils';
        export { Foo } from './foo';
        import './side-effect';
        import StringField from 'https://cardstack.com/base/string';
      `;
      expect(new Set(extractImportSpecifiers(src))).toEqual(
        new Set([
          'https://cardstack.com/base/card-api',
          '../mortgage-calculator',
          './components/utils',
          './foo',
          './side-effect',
          'https://cardstack.com/base/string',
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

  describe('resolveSameRealmFile', () => {
    let realmRoot = 'https://localhost:4201/catalog/';
    let fromAbs =
      'https://localhost:4201/catalog/04868f-mortgage-calculator/components/isolated-template.gts';
    let fileSet = new Set([
      '04868f-mortgage-calculator/mortgage-calculator.gts',
      '04868f-mortgage-calculator/components/utils.gts',
    ]);

    it('resolves a relative import to an existing same-realm .gts file', () => {
      expect(
        resolveSameRealmFile(
          '../mortgage-calculator',
          fromAbs,
          realmRoot,
          fileSet,
        ),
      ).toBe('04868f-mortgage-calculator/mortgage-calculator.gts');
      expect(resolveSameRealmFile('./utils', fromAbs, realmRoot, fileSet)).toBe(
        '04868f-mortgage-calculator/components/utils.gts',
      );
    });

    it('returns null for base-realm and bare (npm) imports', () => {
      expect(
        resolveSameRealmFile(
          'https://cardstack.com/base/string',
          fromAbs,
          realmRoot,
          fileSet,
        ),
      ).toBeNull();
      expect(
        resolveSameRealmFile('@glimmer/component', fromAbs, realmRoot, fileSet),
      ).toBeNull();
    });

    it('returns null when the same-realm file is not present', () => {
      expect(
        resolveSameRealmFile('./missing', fromAbs, realmRoot, fileSet),
      ).toBeNull();
    });

    it('resolves registered-prefix (@cardstack/<realm>/…) same-realm imports', () => {
      expect(
        resolveSameRealmFile(
          '@cardstack/catalog/04868f-mortgage-calculator/mortgage-calculator',
          fromAbs,
          realmRoot,
          fileSet,
        ),
      ).toBe('04868f-mortgage-calculator/mortgage-calculator.gts');
    });

    it('returns null for prefix imports that point at another realm', () => {
      // npm-scoped packages and other realms don't contain this realm's tail.
      expect(
        resolveSameRealmFile(
          '@cardstack/skills/foo',
          fromAbs,
          realmRoot,
          fileSet,
        ),
      ).toBeNull();
    });
  });
});
