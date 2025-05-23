//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/template-missing-invokable');
const RuleTester = require('eslint').RuleTester;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parser: require.resolve('ember-eslint-parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});
ruleTester.run('template-missing-invokable', rule, {
  valid: [
    // Subexpression Invocations
    `
      import { eq } from 'somewhere';
      <template>
        {{#if (eq 1 1)}}
          They're equal
        {{/if}}
      </template>
  `,
    `
      function eq() {}
      <template>
        {{#if (eq 1 1)}}
          They're equal
        {{/if}}
      </template>
    `,
    `
      function x(eq) {
        <template>
          {{#if (eq 1 1)}}
            They're equal
          {{/if}}
        </template>
      }
    `,

    // Mustache Invocations
    `
      import { eq } from 'somewhere';
      <template>
        {{eq 1 1}}
      </template>
    `,
    `
    import { eq } from 'somewhere';
    import MyComponent from 'somewhere';
    <template>
      <MyComponent @flag={{eq 1 1}} />
    </template>
    `,

    // Modifier Invocations
    `
    import { on } from 'somewhere';
    function doSomething() {}
    <template>
      <button {{on "click" doSomething}}>Go</button>
    </template>
  `,
  ],

  invalid: [
    // Subexpression invocations
    {
      code: `
      <template>
        {{#if (eq 1 1)}}
          They're equal
        {{/if}}
      </template>
      `,
      output: `import { eq } from 'ember-truth-helpers';

      <template>
        {{#if (eq 1 1)}}
          They're equal
        {{/if}}
      </template>
      `,
      options: [
        {
          invokables: {
            eq: ['eq', 'ember-truth-helpers'],
          },
        },
      ],

      errors: [
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
      ],
    },

    // Mustache Invocations
    {
      code: `
      <template>
        {{eq 1 1}}
      </template>
    `,
      output: `import { eq } from 'ember-truth-helpers';

      <template>
        {{eq 1 1}}
      </template>
    `,
      options: [
        {
          invokables: {
            eq: ['eq', 'ember-truth-helpers'],
          },
        },
      ],
      errors: [
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
      ],
    },
    {
      code: `
      import MyComponent from 'somewhere';
      <template>
        <MyComponent @flag={{eq 1 1}} />
      </template>
    `,
      output: `import { eq } from 'ember-truth-helpers';

      import MyComponent from 'somewhere';
      <template>
        <MyComponent @flag={{eq 1 1}} />
      </template>
    `,
      options: [
        {
          invokables: {
            eq: ['eq', 'ember-truth-helpers'],
          },
        },
      ],
      errors: [
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
      ],
    },

    // Modifier Inovocations
    {
      code: `
        function doSomething() {}
        <template>
          <button {{on "click" doSomething}}>Go</button>
        </template>
      `,
      output: `import { on } from '@ember/modifier';

        function doSomething() {}
        <template>
          <button {{on "click" doSomething}}>Go</button>
        </template>
      `,
      options: [
        {
          invokables: {
            on: ['on', '@ember/modifier'],
          },
        },
      ],
      errors: [
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
      ],
    },

    // Multiple copies of a fixable invocation
    {
      code: `import { not } from 'ember-truth-helpers';

        let other = <template>
          {{#if (not (eq 3 3)) }}
            three is three
          {{/if}}
        </template>

        <template>
          {{#if (eq 1 1) }}
            one is one
          {{/if}}
          {{#if (eq 2 2) }}
            two is two
          {{/if}}
        </template>
      `,
      output: `import { not, eq } from 'ember-truth-helpers';

        let other = <template>
          {{#if (not (eq 3 3)) }}
            three is three
          {{/if}}
        </template>

        <template>
          {{#if (eq 1 1) }}
            one is one
          {{/if}}
          {{#if (eq 2 2) }}
            two is two
          {{/if}}
        </template>
      `,
      options: [
        {
          invokables: {
            eq: ['eq', 'ember-truth-helpers'],
          },
        },
      ],
      errors: [
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
      ],
    },

    // Auto-fix with a default export
    {
      code: `
      <template>
        {{#if (eq 1 1)}}
          They're equal
        {{/if}}
      </template>
      `,
      output: `import eq from 'ember-truth-helpers/helpers/equal';

      <template>
        {{#if (eq 1 1)}}
          They're equal
        {{/if}}
      </template>
      `,
      options: [
        {
          invokables: {
            eq: ['default', 'ember-truth-helpers/helpers/equal'],
          },
        },
      ],

      errors: [
        {
          type: 'GlimmerPathExpression',
          message: rule.meta.messages['missing-invokable'],
        },
      ],
    },
  ],
});
