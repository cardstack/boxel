'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/unique-percy-snapshot-names');
const RuleTester = require('eslint').RuleTester;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('unique-percy-snapshot-names', rule, {
  valid: [
    {
      name: 'one derived name per test',
      code: `
        test('a', async function (assert) {
          await percySnapshot(assert);
        });
        test('b', async function (assert) {
          await percySnapshot(assert);
        });
      `,
    },
    {
      name: 'a second snapshot with an explicit name',
      code: `
        test('a', async function (assert) {
          await percySnapshot(assert);
          await percySnapshot('Module | a - after opening the card');
        });
      `,
    },
    {
      name: 'two distinct explicit names',
      code: `
        test('a', async function (assert) {
          await percySnapshot('Module | a - error state');
          await percySnapshot(\`Module | a - new room state\`);
        });
      `,
    },
    {
      name: 'a snapshot outside any test',
      code: `
        async function snapshotBoth() {
          await percySnapshot('one');
          await percySnapshot(assert);
        }
      `,
    },
    {
      name: 'a computed name is not comparable, so not a duplicate',
      code: `
        test('a', async function (assert) {
          await percySnapshot(assert);
          await percySnapshot(\`Module | a - \${state}\`);
        });
      `,
    },
    {
      name: 'an identifier name is not comparable either',
      code: `
        test('a', async function (assert) {
          await percySnapshot(assert);
          await percySnapshot(snapshotName);
        });
      `,
    },
    {
      name: 'a literal that differs from the derived name',
      code: `
        module('Module', function () {
          test('a test', async function (assert) {
            await percySnapshot(assert);
            await percySnapshot('Module | a test - after opening');
          });
        });
      `,
    },
    {
      name: 'a method call named test is not a QUnit test',
      code: `
        module('Module', function () {
          test('a test', async function (assert) {
            if (/x/.test(value)) {
              await percySnapshot(assert);
            }
          });
        });
      `,
    },
  ],
  invalid: [
    {
      name: 'two bare snapshots in one test',
      code: `
        test('a', async function (assert) {
          await percySnapshot(assert);
          await percySnapshot(assert);
        });
      `,
      errors: [{ messageId: 'duplicateDerivedName' }],
    },
    {
      name: 'two bare snapshots in a skipped test',
      code: `
        skip('a', async function (assert) {
          await percySnapshot(assert);
          await percySnapshot(assert);
        });
      `,
      errors: [{ messageId: 'duplicateDerivedName' }],
    },
    {
      name: 'two bare snapshots in test.only',
      code: `
        test.only('a', async function (assert) {
          await percySnapshot(assert);
          await percySnapshot(assert);
        });
      `,
      errors: [{ messageId: 'duplicateDerivedName' }],
    },
    {
      name: 'three bare snapshots report twice',
      code: `
        test('a', async function (assert) {
          await percySnapshot(assert);
          await percySnapshot(assert);
          await percySnapshot(assert);
        });
      `,
      errors: [
        { messageId: 'duplicateDerivedName' },
        { messageId: 'duplicateDerivedName' },
      ],
    },
    {
      name: 'the same explicit name twice',
      code: `
        test('a', async function (assert) {
          await percySnapshot('Module | a - error state');
          await percySnapshot('Module | a - error state');
        });
      `,
      errors: [
        {
          messageId: 'duplicateExplicitName',
          data: { name: 'Module | a - error state' },
        },
      ],
    },
    {
      name: 'an explicit name equal to the name Percy would derive',
      code: `
        module('Module', function () {
          test('a test', async function (assert) {
            await percySnapshot(assert);
            await percySnapshot('Module | a test');
          });
        });
      `,
      errors: [
        {
          messageId: 'duplicateExplicitName',
          data: { name: 'Module | a test' },
        },
      ],
    },
    {
      name: 'the derived name written out first, then a bare call',
      code: `
        module('Module', function () {
          test('a test', async function (assert) {
            await percySnapshot('Module | a test');
            await percySnapshot(assert);
          });
        });
      `,
      errors: [{ messageId: 'duplicateDerivedName' }],
    },
    {
      name: 'nested modules join with > to form the derived name',
      code: `
        module('Outer', function () {
          module('Inner', function () {
            test('a test', async function (assert) {
              await percySnapshot(assert);
              await percySnapshot('Outer > Inner | a test');
            });
          });
        });
      `,
      errors: [
        {
          messageId: 'duplicateExplicitName',
          data: { name: 'Outer > Inner | a test' },
        },
      ],
    },
    {
      name: 'an assert parameter under another name still counts as derived',
      code: `
        test('a', async function (a) {
          await percySnapshot(a);
          await percySnapshot(a);
        });
      `,
      errors: [{ messageId: 'duplicateDerivedName' }],
    },
  ],
});
