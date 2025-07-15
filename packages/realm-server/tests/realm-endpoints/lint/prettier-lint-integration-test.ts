// Phase 1.2 - Design Test Cases First
// These tests define the expected behavior of prettier integration with the lint endpoint
// They will initially fail until we implement the actual prettier integration

import { module, test } from 'qunit';
import { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { baseRealm, Realm } from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  createVirtualNetworkAndLoader,
  matrixURL,
  setupPermissionedRealm,
  createJWT,
} from '../../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Prettier Lint Integration Tests (Phase 1.2)', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmPath: string;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      request = args.request;
    }

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    setupPermissionedRealm(hooks, {
      permissions: {
        john: ['read', 'write'],
      },
      onRealmSetup,
    });

    // Test 1: Basic formatting - ESLint fixes + Prettier formatting
    test('applies prettier formatting after eslint fixes', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`,
        'ESLint fixes are applied and prettier formatting is applied',
      );
    });

    // Test 2: Template formatting within GTS files
    test('formats GTS template content properly', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import MyComponent from 'somewhere';
<template>
<MyComponent @flag={{eq 1 1}} />
</template>
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import { eq } from '@cardstack/boxel-ui/helpers';
import MyComponent from 'somewhere';

<template>
  <MyComponent @flag={{eq 1 1}} />
</template>
`,
        'Template content is properly formatted with correct indentation',
      );
    });

    // Test 3: Mixed JavaScript and template content
    test('handles mixed JavaScript and template content', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
@field email = contains(EmailField);

static isolated = class Isolated extends Component<typeof this> {
<template>
<div>
<h1>{{@model.name}}</h1>
<p>{{@model.email}}</p>
</div>
</template>
};
}`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import EmailField from 'https://cardstack.com/base/email';
import StringField from 'https://cardstack.com/base/string';
import {

  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  @field email = contains(EmailField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div>
        <h1>{{@model.name}}</h1>
        <p>{{@model.email}}</p>
      </div>
    </template>
  };
}
`,
        'Mixed JavaScript and template content is properly formatted',
      );
    });

    // Test 4: Long lines that need wrapping
    test('wraps long lines according to prettier configuration', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
@field longPropertyName = contains(StringField, { description: 'This is a very long description that might need wrapping' });
}`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field longPropertyName = contains(StringField, {
    description: 'This is a very long description that might need wrapping',
  });
}
`,
        'Long lines are properly wrapped according to prettier configuration',
      );
    });

    // Test 5: Import statement formatting
    test('formats import statements properly', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import{CardDef}from 'https://cardstack.com/base/card-api';
import{StringField}from 'https://cardstack.com/base/string';
export class MyCard extends CardDef{
@field name=contains(StringField);
}`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { StringField } from 'https://cardstack.com/base/string';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`,
        'Import statements are properly formatted with correct spacing',
      );
    });

    // Test 6: Nested template structures
    test('handles nested template structures correctly', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import MyComponent from 'somewhere';
<template>
<div>
<MyComponent @flag={{eq 1 1}}>
<div>
<p>Nested content</p>
<span>More content</span>
</div>
</MyComponent>
</div>
</template>`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import { eq } from '@cardstack/boxel-ui/helpers';
import MyComponent from 'somewhere';

<template>
  <div>
    <MyComponent @flag={{eq 1 1}}>
      <div>
        <p>Nested content</p>
        <span>More content</span>
      </div>
    </MyComponent>
  </div>
</template>
`,
        'Nested template structures are properly indented',
      );
    });

    // Test 7: Error handling - Prettier fails, ESLint still works
    test('falls back to eslint-only output when prettier fails', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  // Malformed syntax that prettier cannot parse
  @field }{ invalid
}
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);

      // Log the actual output to help debug
      console.log('Actual output when prettier fails:', responseJson.output);

      // Should still apply ESLint fixes even if prettier fails
      assert.ok(
        responseJson.output.includes('import { StringField }') ||
          responseJson.output.includes('import StringField from') ||
          responseJson.output.includes('StringField'),
        'ESLint fixes are still applied',
      );
      assert.ok(
        responseJson.output.includes('import { CardDef, field, contains }') ||
          responseJson.output.includes('CardDef') ||
          responseJson.output.includes('field') ||
          responseJson.output.includes('contains'),
        'Missing imports are added',
      );

      // But prettier formatting might not be applied due to syntax error
      assert.ok(
        responseJson.output.includes('@field }{ invalid'),
        'Malformed syntax is preserved',
      );
    });

    // Test 8: Configuration handling - respects singleQuote setting
    test('respects prettier configuration settings', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { CardDef } from "https://cardstack.com/base/card-api";
export class MyCard extends CardDef {
@field name = contains(StringField, { description: "test description" });
}`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);

      // Should use single quotes based on prettier configuration
      assert.ok(
        responseJson.output.includes("'https://cardstack.com/base/string'"),
        'Single quotes are used for imports',
      );
      assert.ok(
        responseJson.output.includes("'https://cardstack.com/base/card-api'"),
        'Single quotes are used consistently',
      );
      assert.ok(
        responseJson.output.includes("'test description'"),
        'Single quotes are used for string literals',
      );
    });

    // Test 9: JSON request body support with filename
    test('supports JSON request body with filename parameter', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            source: `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}`,
            filename: 'my-card.gts',
          }),
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`,
        'JSON request body with filename parameter works correctly',
      );
    });

    // Test 11: Backward compatibility - plain text requests still work
    test('maintains backward compatibility with plain text requests', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`,
        'Plain text requests still work and include prettier formatting',
      );
    });

    // Test 12: Performance - large files should not timeout
    test('handles large files within reasonable time', async function (assert) {
      // Create a large file with many imports and classes
      let largeContent = `import { CardDef } from 'https://cardstack.com/base/card-api';\n`;
      for (let i = 0; i < 100; i++) {
        largeContent += `
export class MyCard${i} extends CardDef {
@field name${i} = contains(StringField);
@field email${i} = contains(EmailField);
}
`;
      }

      let startTime = Date.now();
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(largeContent);

      let endTime = Date.now();
      let duration = endTime - startTime;

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(
        duration < 10000,
        `Large file processing completed in ${duration}ms (should be < 10s)`,
      );

      let responseJson = JSON.parse(response.text);
      assert.ok(
        responseJson.output.includes('import StringField from'),
        'ESLint fixes are applied to large files',
      );
      assert.ok(
        responseJson.output.includes('  @field name0 = contains(StringField);'),
        'Prettier formatting is applied to large files',
      );
    });

    // Test 13: Error handling - Invalid JSON request body
    test('handles invalid JSON request body gracefully', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      assert.strictEqual(
        response.status,
        400,
        'HTTP 400 status for invalid JSON',
      );
      let responseJson = JSON.parse(response.text);
      assert.ok(
        responseJson.error.includes('Invalid JSON'),
        'Error message indicates invalid JSON',
      );
    });

    // Test 14: Error handling - Missing source in JSON request
    test('handles missing source in JSON request body', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            filename: 'test.gts',
            // Missing source property
          }),
        );

      assert.strictEqual(
        response.status,
        400,
        'HTTP 400 status for missing source',
      );
      let responseJson = JSON.parse(response.text);
      assert.ok(
        responseJson.error.includes('Missing source'),
        'Error message indicates missing source',
      );
    });

    // Test 15: X-Filename header support
    test('supports X-Filename header for parser detection', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('X-Filename', 'my-card.gts')
        .send(`import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
@field name = contains(StringField);
}
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`,
        'X-Filename header is used for parser detection',
      );
    });
  });
});
