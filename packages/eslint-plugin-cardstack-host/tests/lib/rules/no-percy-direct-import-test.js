'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/no-percy-direct-import');
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

ruleTester.run('no-percy-direct-import', rule, {
  valid: [
    {
      code: `import { percySnapshot } from '@cardstack/host/tests/helpers';`,
    },
    {
      code: `import { foo } from 'some-other-module';`,
    },
  ],
  invalid: [
    {
      code: `import percySnapshot from '@percy/ember';`,
      errors: [{ messageId: 'noPercyDirectImport' }],
      output: `import { percySnapshot } from '@cardstack/host/tests/helpers';`,
    },
    {
      code: `import { percySnapshot } from '@percy/ember';`,
      errors: [{ messageId: 'noPercyDirectImport' }],
      output: `import { percySnapshot } from '@cardstack/host/tests/helpers';`,
    },
  ],
});
