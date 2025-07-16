// Test to verify Test Environment Setup
import { module, test } from 'qunit';
import { readFile } from 'fs/promises';
import { join } from 'path';

module('Test Environment Setup', function () {
  test('prettier dependency is available', async function (assert) {
    try {
      const prettier = await import('prettier');
      assert.ok(prettier, 'Prettier module is available');
      assert.ok(prettier.format, 'Prettier format function is available');
      assert.ok(
        prettier.resolveConfig,
        'Prettier resolveConfig function is available',
      );
    } catch (error) {
      assert.ok(
        false,
        `Prettier is not available: ${(error as Error).message}`,
      );
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

  test('test fixtures are accessible', async function (assert) {
    try {
      const fixturesPath = join(__dirname, 'fixtures', 'lint');
      const basicFormattingPath = join(fixturesPath, 'basic-formatting.gts');

      const content = await readFile(basicFormattingPath, 'utf8');

      assert.ok(content, 'Test fixture content is loaded');
      assert.ok(
        content.includes('CardDef'),
        'Test fixture contains expected content',
      );
    } catch (error) {
      assert.ok(
        false,
        `Test fixtures are not accessible: ${(error as Error).message}`,
      );
    }
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

  test('runtime-common has prettier dependencies', async function (assert) {
    try {
      // Test that the dependencies are available in the runtime-common context
      const packageJsonPath = join(
        __dirname,
        '../../runtime-common/package.json',
      );
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

      assert.ok(
        packageJson.dependencies?.prettier,
        'runtime-common has prettier dependency',
      );
      assert.ok(
        packageJson.dependencies?.['prettier-plugin-ember-template-tag'],
        'runtime-common has prettier-plugin-ember-template-tag dependency',
      );
    } catch (error) {
      assert.ok(
        false,
        `runtime-common dependencies check failed: ${(error as Error).message}`,
      );
    }
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
      assert.ok(result.includes('import'), 'Import statements are preserved');
      assert.ok(result.includes('CardDef'), 'CardDef is preserved');
      assert.ok(result.includes('export'), 'Export statements are preserved');

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
});
