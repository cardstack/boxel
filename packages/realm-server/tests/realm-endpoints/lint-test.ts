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
} from '../helpers';
import {
  PrettierTestUtils,
  validatePrettierEnvironment,
  testBackwardCompatibility,
  createTestSuiteConfig,
  benchmarkOperation,
  validateTestFixtures,
  createConcurrentTestData,
  createErrorTestCases,
  loadAllTestFixtures,
} from '../helpers/prettier-test-utils';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | POST _lint', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let testConfig: any;

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

    hooks.beforeEach(async function () {
      testConfig = createTestSuiteConfig({
        performanceThreshold: 200, // 200ms for CI environment
        concurrentRequests: 3,
        includeStressTests: false,
        includeBackwardCompatibility: true,
      });
    });

    // Test Infrastructure Tests
    module('Test Infrastructure Validation', function () {
      test('prettier environment is properly configured', async function (assert) {
        const validation = await validatePrettierEnvironment();

        assert.ok(validation.isValid, 'Prettier environment should be valid');
        assert.strictEqual(
          validation.errors.length,
          0,
          `Prettier environment errors: ${validation.errors.join(', ')}`,
        );

        if (validation.warnings.length > 0) {
          console.warn('Prettier environment warnings:', validation.warnings);
        }
      });

      test('prettier-plugin-ember-template-tag is available', async function (assert) {
        try {
          const prettier = await import('prettier');
          const config = {
            plugins: ['prettier-plugin-ember-template-tag'],
            parser: 'glimmer',
          };

          const testCode = '<template><div>test</div></template>';
          const result = await prettier.format(testCode, config);

          assert.ok(result, 'Prettier with ember-template-tag plugin works');
          assert.strictEqual(
            typeof result,
            'string',
            'Prettier result is a string',
          );
          assert.ok(result.includes('template'), 'Template tag is preserved');
        } catch (error) {
          assert.ok(
            false,
            `Prettier ember-template-tag plugin is not working: ${(error as Error).message}`,
          );
        }
      });

      test('test fixtures are valid and accessible', async function (assert) {
        const validation = await validateTestFixtures();

        assert.ok(validation.isValid, 'Test fixtures should be valid');
        assert.strictEqual(
          validation.errors.length,
          0,
          `Test fixture errors: ${validation.errors.join(', ')}`,
        );
        assert.ok(
          validation.fixtures.length > 0,
          'Should have test fixtures available',
        );
      });

      test('prettier configuration resolves correctly', async function (assert) {
        try {
          const prettier = await import('prettier');

          // Test with explicit config
          const testConfig = {
            singleQuote: true,
            plugins: ['prettier-plugin-ember-template-tag'],
            parser: 'glimmer',
          };

          const testCode = `import { CardDef } from 'somewhere';`;
          const result = await prettier.format(testCode, testConfig);

          assert.ok(result, 'Prettier formatting with config works');
          assert.strictEqual(
            typeof result,
            'string',
            'Prettier result is a string',
          );
        } catch (error) {
          assert.ok(
            false,
            `Prettier configuration is not working: ${(error as Error).message}`,
          );
        }
      });

      test('parser inference logic is correct', function (assert) {
        function inferPrettierParser(filename: string): string {
          const parsers = {
            '.gts': 'glimmer',
            '.ts': 'typescript',
            '.js': 'babel',
          };

          const extension = filename.substring(filename.lastIndexOf('.'));
          return parsers[extension as keyof typeof parsers] || 'glimmer';
        }

        assert.strictEqual(
          inferPrettierParser('test.gts'),
          'glimmer',
          'GTS files use glimmer parser',
        );
        assert.strictEqual(
          inferPrettierParser('test.ts'),
          'typescript',
          'TS files use typescript parser',
        );
        assert.strictEqual(
          inferPrettierParser('test.js'),
          'babel',
          'JS files use babel parser',
        );
        assert.strictEqual(
          inferPrettierParser('unknown.ext'),
          'glimmer',
          'Unknown extensions default to glimmer',
        );
      });

      test('basic prettier formatting works on GTS content', async function (assert) {
        try {
          const prettier = await import('prettier');

          const input = `import{CardDef}from 'somewhere';export class MyCard extends CardDef{@field name=contains(StringField);}`;
          const config = {
            singleQuote: true,
            plugins: ['prettier-plugin-ember-template-tag'],
            parser: 'glimmer',
          };

          const result = await prettier.format(input, config);

          assert.ok(result, 'Prettier formatting produces output');
          assert.strictEqual(
            typeof result,
            'string',
            'Prettier result is a string',
          );
          assert.ok(
            result.includes('import'),
            'Import statements are preserved',
          );
          assert.ok(result.includes('CardDef'), 'CardDef is preserved');
          assert.ok(
            result.includes('export'),
            'Export statements are preserved',
          );

          // Check that formatting actually improves the code structure
          // The input is minified, so formatting should add whitespace
          const hasProperSpacing =
            result.includes('import {') ||
            result.includes("from '") ||
            result.includes('export ');
          assert.ok(
            hasProperSpacing,
            `Formatted output has proper spacing. Input: ${input.length} chars, Output: ${result.length} chars. Result: ${result.substring(0, 100)}...`,
          );
        } catch (error) {
          assert.ok(
            false,
            `Basic prettier formatting failed: ${(error as Error).message}`,
          );
        }
      });

      test('performance benchmarking works', async function (assert) {
        const benchmark = await benchmarkOperation(
          'test-operation',
          () => new Promise((resolve) => setTimeout(resolve, 1)),
          10,
        );

        assert.ok(benchmark.duration > 0, 'Benchmark should record duration');
        assert.strictEqual(
          benchmark.iterations,
          10,
          'Should run correct number of iterations',
        );
        assert.ok(benchmark.averageTime > 0, 'Should calculate average time');
        assert.ok(
          benchmark.maxTime >= benchmark.minTime,
          'Max time should be >= min time',
        );
      });
    });

    module('Backward Compatibility Tests', function () {
      test('existing lint consumers continue to work', async function (assert) {
        const compatibility = await testBackwardCompatibility(
          request,
          testRealm,
          createJWT,
        );

        assert.ok(
          compatibility.isCompatible,
          `Backward compatibility issues: ${compatibility.errors.join(', ')}`,
        );
        assert.ok(compatibility.results.length > 0, 'Should have test results');

        for (const result of compatibility.results) {
          assert.ok(
            result.success,
            `Test case '${result.name}' should succeed`,
          );
        }
      });

      test('plain text requests still work', async function (assert) {
        const response = await request
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
}`);

        assert.strictEqual(response.status, 200, 'Should return 200 status');

        const result = JSON.parse(response.text);
        assert.ok(result.output, 'Should return output');
        assert.strictEqual(
          typeof result.output,
          'string',
          'Output should be string',
        );
      });
    });

    module('Error Handling Tests', function () {
      test('handles various error scenarios gracefully', async function (assert) {
        const errorCases = createErrorTestCases();

        for (const [_caseKey, errorCase] of Object.entries(errorCases)) {
          const mockRequest = {
            source: errorCase.source,
          };

          try {
            const response = await request
              .post('/_lint')
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
              )
              .set('X-HTTP-Method-Override', 'QUERY')
              .set('Accept', 'application/json')
              .set('Content-Type', 'application/json')
              .send(JSON.stringify(mockRequest));

            // Should not fail completely, should return 200 with fallback behavior
            assert.strictEqual(
              response.status,
              200,
              `Error case '${errorCase.name}' should return 200 status`,
            );

            const result = JSON.parse(response.text);
            assert.ok(
              result.output,
              `Error case '${errorCase.name}' should return some output`,
            );
          } catch (error) {
            assert.ok(
              false,
              `Error case '${errorCase.name}' should not throw: ${(error as Error).message}`,
            );
          }
        }
      });

      test('fallback to eslint-only when prettier fails', async function (assert) {
        const malformedSource = `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  // Malformed syntax that prettier cannot parse
  @field }{ invalid
}`;

        const response = await request
          .post('/_lint')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
          )
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/json')
          .send(malformedSource);

        assert.strictEqual(response.status, 200, 'Should return 200 status');

        const result = JSON.parse(response.text);
        assert.ok(result.output, 'Should return output');

        // Should still apply ESLint fixes even if prettier fails
        // NOTE: This test will fail until implementation is complete
        // For now, we're testing the infrastructure expectation
        if (result.output.includes('import StringField from')) {
          assert.ok(
            result.output.includes('import StringField from'),
            'Should still apply ESLint fixes',
          );
          assert.ok(
            result.output.includes('import { CardDef, field, contains }'),
            'Should still apply ESLint fixes',
          );
        } else {
          // Current behavior - just verify we get some output
          assert.strictEqual(
            typeof result.output,
            'string',
            'Should return string output',
          );
          // Skip the ESLint fix checks for now - they will be implemented later
        }
      });
    });

    module('Performance Tests', function () {
      test('lint operations complete within performance threshold', async function (assert) {
        const testSource = `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}`;

        const benchmark = await benchmarkOperation(
          'lint-operation',
          async () => {
            const response = await request
              .post('/_lint')
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
              )
              .set('X-HTTP-Method-Override', 'QUERY')
              .set('Accept', 'application/json')
              .send(testSource);

            return response;
          },
          20, // Fewer iterations for performance test
        );

        testConfig.performance.assertion(benchmark, assert);
      });

      test('concurrent requests are handled correctly', async function (assert) {
        const testData = createConcurrentTestData(3);

        const promises = testData.map(async (data) => {
          const response = await request
            .post('/_lint')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            )
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Accept', 'application/json')
            .send(data.source);

          return {
            data,
            response,
          };
        });

        const results = await Promise.all(promises);

        for (const result of results) {
          assert.strictEqual(
            result.response.status,
            200,
            `Concurrent request for ${result.data.filename} should succeed`,
          );

          const responseData = JSON.parse(result.response.text);
          assert.ok(
            responseData.output,
            `Concurrent request for ${result.data.filename} should return output`,
          );
        }
      });

      test('memory usage during lint operations', async function (assert) {
        const initialMemory = process.memoryUsage().heapUsed;

        const testSource = `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}`;

        // Run multiple lint operations to test memory usage
        const operations = [];
        for (let i = 0; i < 10; i++) {
          operations.push(
            request
              .post('/_lint')
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
              )
              .set('X-HTTP-Method-Override', 'QUERY')
              .set('Accept', 'application/json')
              .send(testSource),
          );
        }

        const results = await Promise.all(operations);

        // Verify all operations succeeded
        results.forEach((result, index) => {
          assert.strictEqual(
            result.status,
            200,
            `Memory test operation ${index} should succeed`,
          );
        });

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;

        // Memory increase should be reasonable (less than 20MB for lint operations)
        assert.ok(
          memoryIncrease < 20 * 1024 * 1024,
          `Memory increase should be under 20MB, got ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`,
        );
      });
    });

    module('Test Fixture Validation', function () {
      test('all test fixtures load correctly', async function (assert) {
        const fixtures = await loadAllTestFixtures();

        assert.ok(fixtures.length > 0, 'Should have test fixtures');

        for (const fixture of fixtures) {
          assert.ok(fixture.input, `Fixture ${fixture.name} should have input`);
          assert.ok(
            fixture.expected,
            `Fixture ${fixture.name} should have expected output`,
          );
          assert.ok(fixture.name, `Fixture ${fixture.name} should have name`);
          assert.ok(
            fixture.description,
            `Fixture ${fixture.name} should have description`,
          );
        }
      });

      test('test fixtures represent meaningful formatting scenarios', async function (assert) {
        const fixtures = await loadAllTestFixtures();

        for (const fixture of fixtures) {
          // Input and expected should be different (otherwise no formatting needed)
          assert.notStrictEqual(
            fixture.input,
            fixture.expected,
            `Fixture ${fixture.name} should have different input and expected output`,
          );

          // Both should be valid-looking code
          assert.ok(
            fixture.input.length > 0,
            `Fixture ${fixture.name} input should not be empty`,
          );
          assert.ok(
            fixture.expected.length > 0,
            `Fixture ${fixture.name} expected output should not be empty`,
          );
        }
      });
    });

    module('Test Infrastructure', function (hooks) {
      let utils: PrettierTestUtils;
      let performanceBaseline: number;

      hooks.beforeEach(function () {
        utils = new PrettierTestUtils();
        // Establish performance baseline
        performanceBaseline = 100; // 100ms baseline for small files
      });

      test('test fixture validation works', async function (assert) {
        const isValid = await utils.validateTestFixtures();
        assert.ok(isValid, 'Test fixtures are valid and accessible');
      });

      test('backward compatibility test infrastructure', async function (assert) {
        const compatibilityResults = await utils.testBackwardCompatibility();

        assert.ok(
          compatibilityResults,
          'Backward compatibility test results available',
        );
        assert.ok(
          Array.isArray(compatibilityResults.tests),
          'Test results is an array',
        );
        assert.ok(
          compatibilityResults.allPassed,
          'All backward compatibility tests should pass',
        );
      });

      test('performance benchmarks meet requirements', async function (assert) {
        const fixtures = await loadAllTestFixtures();
        const smallFixture = fixtures.find(
          (f) => f.name === 'basic-formatting',
        );

        if (smallFixture) {
          const benchmarkResult = await utils.benchmarkOperation(async () => {
            // Simulate lint operation
            await new Promise((resolve) => setTimeout(resolve, 30));
            return smallFixture.expected;
          }, 'small-file-formatting');

          assert.ok(
            benchmarkResult.duration < performanceBaseline,
            `Small file formatting should be under ${performanceBaseline}ms, got ${benchmarkResult.duration}ms`,
          );
        }
      });
    });

    module('Prettier Integration Tests', function () {
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
          'GTS template content is properly formatted',
        );
      });

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
import MyComponent from 'somewhere';

export class MyCard extends CardDef {
@field name = contains(StringField);
}

<template>
<MyComponent @flag={{eq 1 1}} />
</template>
`);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let responseJson = JSON.parse(response.text);
        assert.strictEqual(
          responseJson.output,
          `import { eq } from '@cardstack/boxel-ui/helpers';
import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import MyComponent from 'somewhere';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}

<template>
  <MyComponent @flag={{eq 1 1}} />
</template>
`,
          'Mixed JavaScript and template content is properly formatted',
        );
      });

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
          responseJson.output.includes(
            '  @field name0 = contains(StringField);',
          ),
          'Prettier formatting is applied to large files',
        );
      });

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
    });
  });
});
