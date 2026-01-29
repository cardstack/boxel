const rule = require('../../../lib/rules/no-css-position-fixed');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parser: require.resolve('ember-eslint-parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});
ruleTester.run('no-css-position-fixed', rule, {
  valid: [
    `
      <template>
        <div class="my-card">Hello</div>
        <style scoped>
          .my-card {
            position: relative;
            top: 0;
          }
        </style>
      </template>
    `,
    `
      <template>
        <div class="my-card">Hello</div>
        <style scoped>
          .my-card {
            position: absolute;
            top: 0;
          }
        </style>
      </template>
    `,
    `
      <template>
        <div class="my-card">Hello</div>
        <style scoped>
          .my-card {
            position: sticky;
            top: 0;
          }
        </style>
      </template>
    `,
    // No style tag at all
    `
      <template>
        <div class="my-card">Hello</div>
      </template>
    `,
  ],

  invalid: [
    {
      code: `
        <template>
          <div class="my-card">Hello</div>
          <style scoped>
            .my-card {
              position: fixed;
              top: 0;
            }
          </style>
        </template>
      `,
      errors: [
        {
          type: 'GlimmerTextNode',
          message: rule.meta.messages['no-css-position-fixed'],
        },
      ],
    },
    // Without space after colon
    {
      code: `
        <template>
          <style scoped>
            .my-card {
              position:fixed;
            }
          </style>
        </template>
      `,
      errors: [
        {
          type: 'GlimmerTextNode',
          message: rule.meta.messages['no-css-position-fixed'],
        },
      ],
    },
    // With extra whitespace
    {
      code: `
        <template>
          <style scoped>
            .my-card {
              position:  fixed;
            }
          </style>
        </template>
      `,
      errors: [
        {
          type: 'GlimmerTextNode',
          message: rule.meta.messages['no-css-position-fixed'],
        },
      ],
    },
    // Multiple occurrences
    {
      code: `
        <template>
          <style scoped>
            .my-card {
              position: fixed;
            }
            .another {
              position: fixed;
            }
          </style>
        </template>
      `,
      errors: [
        {
          type: 'GlimmerTextNode',
          message: rule.meta.messages['no-css-position-fixed'],
        },
        {
          type: 'GlimmerTextNode',
          message: rule.meta.messages['no-css-position-fixed'],
        },
      ],
    },
  ],
});
