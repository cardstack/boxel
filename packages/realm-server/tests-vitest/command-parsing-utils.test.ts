import { commandUrlToCodeRef, parseBoxelHostCommandSpecifier } from '@cardstack/runtime-common/command-parsing-utils';
import { describe, expect, it } from 'vitest';

describe('command-parsing-utils-test.ts', function () {
  describe('command parsing utils', function () {
    it('parseBoxelHostCommandSpecifier parses scoped command specifier', async function () {
      expect(
        parseBoxelHostCommandSpecifier(
          '@cardstack/boxel-host/commands/show-card/default',
        ),
      ).toEqual({
        module: '@cardstack/boxel-host/commands/show-card',
        name: 'default',
      });
    });

    it('parseBoxelHostCommandSpecifier rejects unscoped command specifier', async function () {
      expect(
        parseBoxelHostCommandSpecifier(
          'cardstack/boxel-host/commands/show-card/execute',
        ),
      ).toBeUndefined();
    });

    it('parseBoxelHostCommandSpecifier rejects specifier without export name', async function () {
      expect(
        parseBoxelHostCommandSpecifier('cardstack/boxel-host/commands/show-card'),
      ).toBeUndefined();
    });

    it('parseBoxelHostCommandSpecifier rejects query/hash forms', async function () {
      expect(
        parseBoxelHostCommandSpecifier(
          '@cardstack/boxel-host/commands/show-card/default?foo=bar',
        ),
      ).toBeUndefined();
      expect(
        parseBoxelHostCommandSpecifier(
          '@cardstack/boxel-host/commands/show-card/default#main',
        ),
      ).toBeUndefined();
    });

    it('requires explicit export for cardstack/boxel-host command specifier', async function () {
      expect(
        commandUrlToCodeRef(
          'cardstack/boxel-host/commands/show-card',
          undefined,
        ),
      ).toBeUndefined();
    });

    it('parses cardstack/boxel-host command specifier with explicit export', async function () {
      expect(
        commandUrlToCodeRef(
          '@cardstack/boxel-host/commands/show-card/execute',
          undefined,
        ),
      ).toEqual({
        module: '@cardstack/boxel-host/commands/show-card',
        name: 'execute',
      });
    });

    it('parses absolute /commands URL into realm code ref', async function () {
      expect(
        commandUrlToCodeRef(
          'http://localhost:4200/commands/create-listing-pr/default',
          'http://localhost:4201/test/',
        ),
      ).toEqual({
        module: 'http://localhost:4201/test/commands/create-listing-pr',
        name: 'default',
      });
    });

    it('parses absolute /commands URL without export into default export', async function () {
      expect(
        commandUrlToCodeRef(
          'http://localhost:4200/commands/create-listing-pr',
          'http://localhost:4201/test/',
        ),
      ).toEqual({
        module: 'http://localhost:4201/test/commands/create-listing-pr',
        name: 'default',
      });
    });

    it('rejects nested /commands paths', async function () {
      expect(
        commandUrlToCodeRef(
          'http://localhost:4200/commands/../../admin/commands/dangerous/action',
          'http://localhost:4201/test/',
        ),
      ).toBeUndefined();
    });

    it('rejects traversal-like command segments', async function () {
      expect(
        commandUrlToCodeRef(
          'http://localhost:4200/commands/%2E%2E/default',
          'http://localhost:4201/test/',
        ),
      ).toBeUndefined();
      expect(
        commandUrlToCodeRef(
          'http://localhost:4200/commands/create-listing-pr/%2E%2E',
          'http://localhost:4201/test/',
        ),
      ).toBeUndefined();
    });

    it('rejects extra path segments beyond command and export', async function () {
      expect(
        commandUrlToCodeRef(
          'http://localhost:4200/commands/create-listing-pr/default/extra',
          'http://localhost:4201/test/',
        ),
      ).toBeUndefined();
    });

    it('returns undefined for unknown command formats', async function () {
      expect(
        commandUrlToCodeRef(
          'https://example.com/not-commands/create-listing-pr',
          'http://localhost:4201/test/',
        ),
      ).toBeUndefined();
    });
  });
});
