'use strict';

const path = require('path');
const rule = require('../../../lib/rules/no-url-from-realm-identifier');
const RuleTester = require('eslint').RuleTester;

const fixtures = path.join(__dirname, 'fixtures');

// This rule reads types, so the tester needs a real TypeScript program.
const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: path.join(fixtures, 'tsconfig.json'),
    tsconfigRootDir: fixtures,
    // The parser infers a one-shot CLI run from the environment — `CI=true` is
    // one of the signals — and a one-shot run builds its program from disk. The
    // tester supplies each case's source in memory against a fixture path whose
    // file on disk is empty, so an inferred single run types every case against
    // that empty file: the rule sees the right syntax and no types, and reports
    // nothing. Asking for the watch-style program keeps the supplied source
    // visible to the type checker.
    disallowAutomaticSingleRunInference: true,
  },
});

const IMPORT = `import { rri, ri } from './identifiers';\n`;
const filename = path.join(fixtures, 'subject.ts');

ruleTester.run('no-url-from-realm-identifier', rule, {
  valid: [
    // A plain string is not an identifier — the rule is about the brand, not
    // about calling `new URL` at all.
    {
      code: `let u = new URL('https://example.com/base/');`,
      filename,
    },
    // Resolving through the VirtualNetwork is the sanctioned boundary.
    {
      code: `${IMPORT}declare const vn: { toURL(x: string): URL };\nlet u = vn.toURL(rri('@cardstack/base/card-api'));`,
      filename,
    },
    // Reading a URL's own href back is unrelated to the identifier types.
    {
      code: `let u = new URL(new URL('https://example.com/').href);`,
      filename,
    },
    // A comparison against an identifier yields a boolean, not an identifier.
    {
      code: `${IMPORT}declare const a: string;\nlet u = new URL(a === rri('@cardstack/base/x') ? 'https://example.com/' : 'https://example.org/');`,
      filename,
    },
    // An identifier behind an absolute prefix does not decide the leading
    // spelling: the result parses whatever the identifier holds.
    {
      code: `${IMPORT}let id = rri('@cardstack/base/card-api');\nlet u = new URL(`+"`https://example.test/lookup/${id}`"+`);`,
      filename,
    },
    {
      code: `${IMPORT}let id = rri('@cardstack/base/card-api');\nlet u = new URL('https://example.test/lookup/' + id);`,
      filename,
    },
  ],

  invalid: [
    {
      code: `${IMPORT}let u = new URL(rri('@cardstack/base/card-api'));`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    {
      code: `${IMPORT}let u = new URL(ri('@cardstack/base/'));`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // Through a variable, which is where the compiler's silence really bites.
    {
      code: `${IMPORT}let id = rri('@cardstack/catalog/Author/mango');\nlet u = new URL(id);`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // A second argument does not make the first one safe.
    {
      code: `${IMPORT}let u = new URL(rri('@cardstack/base/x'), 'https://example.com/');`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // An optional identifier still carries the brand in its union.
    {
      code: `${IMPORT}declare const maybe: ReturnType<typeof rri> | undefined;\nlet u = new URL(maybe as ReturnType<typeof rri>);`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // A ternary between an identifier and a plain string: the union
    // `RealmResourceIdentifier | string` reduces to `string`, so the argument's
    // own type carries no brand and only walking the branches finds it.
    {
      code: `${IMPORT}let m = rri('@cardstack/base/card-api');\nlet u = new URL(m.endsWith('.gts') ? m : `+"`${m}.gts`"+`);`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // Interpolating an identifier produces a string that is still spelled like
    // an identifier.
    {
      code: `${IMPORT}let m = rri('@cardstack/base/card-api');\nlet u = new URL(`+"`${m}.gts`"+`);`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // Concatenation erases the brand the same way.
    {
      code: `${IMPORT}let m = rri('@cardstack/base/card-api');\nlet u = new URL(m + '.gts');`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // A fallback through `??` keeps the identifier on one side.
    {
      code: `${IMPORT}declare const maybe: ReturnType<typeof rri> | undefined;\nlet u = new URL(maybe ?? 'https://example.com/');`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
    // Computing the value into a `const` first is the shape this appears in:
    // the local's own type is `string`, and the identifier is only visible in
    // the expression it was initialized with.
    {
      code: `${IMPORT}const m = rri('@cardstack/base/card-api');\nconst f = m.endsWith('.gts') ? m : `+"`${m}.gts`"+`;\nlet u = new URL(f);`,
      filename,
      errors: [{ messageId: 'urlFromIdentifier' }],
    },
  ],
});
