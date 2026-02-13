const rule = require('../../../lib/rules/no-forbidden-head-tags');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parser: require.resolve('ember-eslint-parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-forbidden-head-tags', rule, {
  valid: [
    // Allowed tags in static head
    `
      class MyCard {
        static head = class Head {
          <template>
            <title>My Title</title>
            <meta name="description" content="desc" />
            <link rel="canonical" href="/" />
          </template>
        };
      }
    `,
    // Script and style outside of static head are fine
    `
      <template>
        <div>Hello</div>
        <style scoped>.card { color: red }</style>
      </template>
    `,
    // Non-head static property is fine
    `
      class MyCard {
        static isolated = class Isolated {
          <template>
            <div>Hello</div>
            <style scoped>.card { color: red }</style>
          </template>
        };
      }
    `,
  ],

  invalid: [
    // Script in static head
    {
      code: `
        class MyCard {
          static head = class Head {
            <template>
              <title>Test</title>
              <script>void 0</script>
            </template>
          };
        }
      `,
      errors: [
        {
          messageId: 'no-forbidden-head-tags',
          data: { tag: 'script' },
        },
      ],
    },
    // Style in static head
    {
      code: `
        class MyCard {
          static head = class Head {
            <template>
              <title>Test</title>
              <style>.injected { color: red }</style>
            </template>
          };
        }
      `,
      errors: [
        {
          messageId: 'no-forbidden-head-tags',
          data: { tag: 'style' },
        },
      ],
    },
    // Multiple disallowed tags
    {
      code: `
        class MyCard {
          static head = class Head {
            <template>
              <title>Test</title>
              <script>void 0</script>
              <style>.x { color: red }</style>
            </template>
          };
        }
      `,
      errors: [
        {
          messageId: 'no-forbidden-head-tags',
          data: { tag: 'script' },
        },
        {
          messageId: 'no-forbidden-head-tags',
          data: { tag: 'style' },
        },
      ],
    },
    // Div in static head
    {
      code: `
        class MyCard {
          static head = class Head {
            <template>
              <div>bad</div>
            </template>
          };
        }
      `,
      errors: [
        {
          messageId: 'no-forbidden-head-tags',
          data: { tag: 'div' },
        },
      ],
    },
  ],
});
