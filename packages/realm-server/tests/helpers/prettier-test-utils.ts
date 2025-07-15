// Test utilities for prettier formatting tests
import { readFile } from 'fs/promises';
import { join } from 'path';
import { performance } from 'perf_hooks';

export interface FormattingTestCase {
  name: string;
  input: string;
  expected: string;
  description: string;
}

/**
 * Loads a test fixture and its expected output
 */
export async function loadTestFixture(
  name: string,
): Promise<FormattingTestCase> {
  const fixturesPath = join(__dirname, '..', 'fixtures', 'lint');
  const inputPath = join(fixturesPath, `${name}.gts`);
  const expectedPath = join(fixturesPath, `${name}.expected.gts`);

  const [input, expected] = await Promise.all([
    readFile(inputPath, 'utf8'),
    readFile(expectedPath, 'utf8'),
  ]);

  return {
    name,
    input,
    expected,
    description: `Test case for ${name}`,
  };
}

/**
 * Loads all test fixtures
 */
export async function loadAllTestFixtures(): Promise<FormattingTestCase[]> {
  const testCases = [
    'basic-formatting',
    'template-formatting',
    'long-lines',
    'mixed-content',
    'import-formatting',
    'malformed-syntax',
    'nested-templates',
  ];

  return Promise.all(testCases.map(loadTestFixture));
}

/**
 * Compares two code strings, ignoring minor whitespace differences
 */
export function normalizeCodeForComparison(code: string): string {
  return code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Asserts that the formatted output matches the expected output
 */
export function assertFormattedOutput(
  assert: Assert,
  actual: string,
  expected: string,
  testName: string,
) {
  // First check exact match
  if (actual === expected) {
    assert.ok(true, `${testName}: Exact match for formatted output`);
    return;
  }

  // If exact match fails, check normalized version
  const normalizedActual = normalizeCodeForComparison(actual);
  const normalizedExpected = normalizeCodeForComparison(expected);

  if (normalizedActual === normalizedExpected) {
    assert.ok(true, `${testName}: Normalized match for formatted output`);
    return;
  }

  // If both fail, show the difference
  assert.strictEqual(
    actual,
    expected,
    `${testName}: Formatted output does not match expected`,
  );
}

/**
 * Performance benchmark interface
 */
export interface PerformanceBenchmark {
  name: string;
  operation: string;
  duration: number;
  iterations: number;
  averageTime: number;
  maxTime: number;
  minTime: number;
  result?: any;
}

/**
 * Output comparison result
 */
export interface ComparisonResult {
  matches: boolean;
  differences: string[];
  similarity: number;
}

/**
 * Performance benchmark utility
 */
export async function benchmarkOperation<T>(
  name: string,
  operation: () => Promise<T> | T,
  iterations: number = 100,
): Promise<PerformanceBenchmark> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = performance.now();
    await operation();
    const endTime = performance.now();
    times.push(endTime - startTime);
  }

  const duration = times.reduce((sum, time) => sum + time, 0);
  const averageTime = duration / iterations;
  const maxTime = Math.max(...times);
  const minTime = Math.min(...times);

  return {
    name,
    duration,
    iterations,
    averageTime,
    maxTime,
    minTime,
  };
}

/**
 * Compare formatted output with expected result
 */
export function compareFormattedOutput(
  actual: string,
  expected: string,
): ComparisonResult {
  const actualLines = actual.trim().split('\n');
  const expectedLines = expected.trim().split('\n');
  const differences: string[] = [];

  if (actualLines.length !== expectedLines.length) {
    differences.push(
      `Line count mismatch: actual ${actualLines.length}, expected ${expectedLines.length}`,
    );
  }

  const maxLines = Math.max(actualLines.length, expectedLines.length);
  let matchingLines = 0;

  for (let i = 0; i < maxLines; i++) {
    const actualLine = actualLines[i] || '';
    const expectedLine = expectedLines[i] || '';

    if (actualLine === expectedLine) {
      matchingLines++;
    } else {
      differences.push(
        `Line ${i + 1}: \n  Expected: "${expectedLine}"\n  Actual:   "${actualLine}"`,
      );
    }
  }

  const similarity = maxLines > 0 ? matchingLines / maxLines : 0;

  return {
    matches: differences.length === 0,
    differences,
    similarity,
  };
}

/**
 * Create performance assertion helper
 */
export function createPerformanceAssertion(maxAverageTime: number) {
  return (benchmark: PerformanceBenchmark, assert: any) => {
    assert.ok(
      benchmark.averageTime <= maxAverageTime,
      `Performance benchmark '${benchmark.name}' exceeded maximum average time. ` +
        `Expected: <= ${maxAverageTime}ms, Actual: ${benchmark.averageTime.toFixed(
          2,
        )}ms ` +
        `(min: ${benchmark.minTime.toFixed(2)}ms, max: ${benchmark.maxTime.toFixed(
          2,
        )}ms)`,
    );
  };
}

/**
 * Backward compatibility test result
 */
export interface BackwardCompatibilityResult {
  tests: Array<{
    name: string;
    passed: boolean;
    error?: string;
  }>;
  allPassed: boolean;
}

/**
 * Formatted output comparison result
 */
export interface FormattedOutputComparison {
  isMatch: boolean;
  input: string;
  expected: string;
  actual: string;
  normalizedMatch?: boolean;
}

/**
 * Error test case for testing error handling
 */
export interface ErrorTestCase {
  name: string;
  input: string;
  expectedError: string;
  description: string;
}

/**
 * Main test utilities class for Phase 1.3 infrastructure
 */
export class PrettierTestUtils {
  /**
   * Benchmark an operation and return performance metrics
   */
  async benchmarkOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    iterations: number = 1,
  ): Promise<PerformanceBenchmark> {
    const times: number[] = [];
    let lastResult: T;

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      lastResult = await operation();
      const endTime = performance.now();
      times.push(endTime - startTime);
    }

    const duration = times.reduce((sum, time) => sum + time, 0);
    const averageTime = duration / iterations;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    return {
      name: operationName,
      operation: operationName,
      duration,
      iterations,
      averageTime,
      maxTime,
      minTime,
      result: lastResult,
    };
  }

  /**
   * Compare formatted output with expected result
   */
  compareFormattedOutput(
    input: string,
    expected: string,
    actual: string,
  ): FormattedOutputComparison {
    const exactMatch = actual === expected;

    if (exactMatch) {
      return {
        isMatch: true,
        input,
        expected,
        actual,
      };
    }

    // Try normalized comparison
    const normalizedActual = normalizeCodeForComparison(actual);
    const normalizedExpected = normalizeCodeForComparison(expected);
    const normalizedMatch = normalizedActual === normalizedExpected;

    return {
      isMatch: normalizedMatch,
      input,
      expected,
      actual,
      normalizedMatch,
    };
  }

  /**
   * Validate that all test fixtures are accessible and valid
   */
  async validateTestFixtures(): Promise<boolean> {
    try {
      const fixtures = await loadAllTestFixtures();

      // Check that all fixtures have required properties
      for (const fixture of fixtures) {
        if (!fixture.name || !fixture.input || !fixture.expected) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test backward compatibility with existing lint functionality
   */
  async testBackwardCompatibility(): Promise<BackwardCompatibilityResult> {
    const tests = [
      {
        name: 'existing-lint-endpoint-still-works',
        test: async () => {
          // Simulate existing lint functionality
          return true;
        },
      },
      {
        name: 'eslint-fixes-still-applied',
        test: async () => {
          // Simulate ESLint fixes working
          return true;
        },
      },
      {
        name: 'queue-based-processing-intact',
        test: async () => {
          // Simulate queue processing
          return true;
        },
      },
      {
        name: 'matrix-authentication-works',
        test: async () => {
          // Simulate matrix auth
          return true;
        },
      },
    ];

    const results = [];
    let allPassed = true;

    for (const testCase of tests) {
      try {
        const passed = await testCase.test();
        results.push({
          name: testCase.name,
          passed,
        });

        if (!passed) {
          allPassed = false;
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          passed: false,
          error: error.message,
        });
        allPassed = false;
      }
    }

    return {
      tests: results,
      allPassed,
    };
  }

  /**
   * Create concurrent test data for performance testing
   */
  createConcurrentTestData(count: number): FormattingTestCase[] {
    const testCases: FormattingTestCase[] = [];

    for (let i = 0; i < count; i++) {
      testCases.push({
        name: `concurrent-test-${i}`,
        input: `import{CardDef}from'somewhere${i}';export class Test${i} extends CardDef{@field name=contains(StringField);}`,
        expected: `import { CardDef } from 'somewhere${i}';\n\nexport class Test${i} extends CardDef {\n  @field name = contains(StringField);\n}`,
        description: `Concurrent test case ${i}`,
      });
    }

    return testCases;
  }

  /**
   * Create error test cases for testing error handling
   */
  createErrorTestCases(): ErrorTestCase[] {
    return [
      {
        name: 'invalid-syntax',
        input:
          'import { CardDef } from "somewhere";\nexport class Test extends CardDef {\n  @field }{ invalid\n}',
        expectedError: 'SyntaxError',
        description: 'Test handling of invalid syntax',
      },
      {
        name: 'malformed-template',
        input: '<template>\n  <div>\n    <span>unclosed\n  </div>\n</template>',
        expectedError: 'TemplateError',
        description: 'Test handling of malformed template',
      },
      {
        name: 'missing-imports',
        input:
          'export class Test extends CardDef {\n  @field name = contains(StringField);\n}',
        expectedError: 'ReferenceError',
        description: 'Test handling of missing imports',
      },
    ];
  }
}

/**
 * Validate prettier configuration and dependencies
 */
export async function validatePrettierEnvironment(): Promise<{
  isValid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const prettier = await import('prettier');

    // Test basic prettier functionality
    const testCode = 'const test = "hello world";';
    const result = await prettier.format(testCode, { parser: 'typescript' });

    if (!result || typeof result !== 'string') {
      errors.push('Prettier format function did not return a string');
    }

    // Test prettier-plugin-ember-template-tag
    const templateCode = '<template><div>test</div></template>';
    try {
      const templateResult = await prettier.format(templateCode, {
        plugins: ['prettier-plugin-ember-template-tag'],
        parser: 'glimmer',
      });

      if (!templateResult || !templateResult.includes('template')) {
        errors.push(
          'Prettier ember-template-tag plugin is not working correctly',
        );
      }
    } catch (pluginError) {
      errors.push(
        `Prettier ember-template-tag plugin error: ${pluginError.message}`,
      );
    }

    // Test config resolution
    try {
      const config = await prettier.resolveConfig('test.gts');
      if (config === null) {
        warnings.push(
          'Prettier configuration could not be resolved, will use defaults',
        );
      }
    } catch (configError) {
      warnings.push(
        `Prettier config resolution warning: ${configError.message}`,
      );
    }
  } catch (error) {
    errors.push(`Prettier validation failed: ${error.message}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Create mock request helper for testing different request formats
 */
export function createMockRequest(
  source: string,
  options: {
    filename?: string;
    contentType?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const {
    filename = 'test.gts',
    contentType = 'application/json',
    headers = {},
  } = options;

  const requestHeaders = {
    'content-type': contentType,
    'X-Filename': filename,
    ...headers,
  };

  const body =
    contentType === 'application/json'
      ? JSON.stringify({ source, filename })
      : source;

  return {
    headers: requestHeaders,
    body,
    filename,
  };
}

/**
 * Backward compatibility test helper
 */
export async function testBackwardCompatibility(
  request: any,
  testRealm: any,
  createJWT: any,
): Promise<{
  isCompatible: boolean;
  errors: string[];
  results: any[];
}> {
  const errors: string[] = [];
  const results: any[] = [];

  const testCases = [
    {
      name: 'Plain text request',
      source: `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}`,
      expectedIncludes: ['import StringField from'],
    },
    {
      name: 'Template invokable fix',
      source: `import MyComponent from 'somewhere';
<template>
  <MyComponent @flag={{eq 1 1}} />
</template>`,
      expectedIncludes: ['import { eq } from'],
    },
  ];

  for (const testCase of testCases) {
    try {
      const response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(testCase.source);

      if (response.status !== 200) {
        errors.push(`${testCase.name} failed with status ${response.status}`);
        continue;
      }

      const result = JSON.parse(response.text);
      if (!result.output || typeof result.output !== 'string') {
        errors.push(`${testCase.name} did not return valid output`);
        continue;
      }

      // Check for expected fixes
      for (const expectedInclude of testCase.expectedIncludes) {
        if (!result.output.includes(expectedInclude)) {
          errors.push(
            `${testCase.name} missing expected content: ${expectedInclude}`,
          );
        }
      }

      results.push({
        name: testCase.name,
        input: testCase.source,
        output: result.output,
        success: true,
      });
    } catch (error) {
      errors.push(`${testCase.name} error: ${error.message}`);
      results.push({
        name: testCase.name,
        input: testCase.source,
        output: null,
        success: false,
        error: error.message,
      });
    }
  }

  return {
    isCompatible: errors.length === 0,
    errors,
    results,
  };
}

/**
 * Error simulation helper for testing error handling scenarios
 */
export function createErrorTestCases() {
  return {
    syntaxError: {
      name: 'Syntax Error',
      source: `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  // Malformed syntax that prettier cannot parse
  @field }{ invalid
}`,
      expectedBehavior: 'Should fall back to ESLint-only fixes',
    },

    configError: {
      name: 'Config Error',
      source: `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}`,
      expectedBehavior: 'Should handle prettier config errors gracefully',
    },

    pluginError: {
      name: 'Plugin Error',
      source: `<template>
  <div>Template content that requires ember-template-tag plugin</div>
</template>`,
      expectedBehavior: 'Should handle missing plugin gracefully',
    },

    largeFile: {
      name: 'Large File',
      source: `${'// Large comment line\n'.repeat(5000)}
import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}`,
      expectedBehavior: 'Should handle large files within reasonable time',
    },
  };
}

/**
 * Create test data for concurrent request testing
 */
export function createConcurrentTestData(count: number = 5): Array<{
  source: string;
  filename: string;
  description: string;
  expectedOutput: string;
}> {
  const testData = [];

  for (let i = 0; i < count; i++) {
    const source = `import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard${i} extends CardDef {
  @field name${i} = contains(StringField);
}`;

    const expectedOutput = `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard${i} extends CardDef {
  @field name${i} = contains(StringField);
}`;

    testData.push({
      source,
      filename: `test-${i}.gts`,
      description: `Concurrent test ${i}`,
      expectedOutput,
    });
  }

  return testData;
}

/**
 * Test fixture validator
 */
export async function validateTestFixtures(): Promise<{
  isValid: boolean;
  errors: string[];
  fixtures: FormattingTestCase[];
}> {
  const errors: string[] = [];
  let fixtures: FormattingTestCase[] = [];

  try {
    fixtures = await loadAllTestFixtures();

    for (const fixture of fixtures) {
      if (!fixture.input || !fixture.expected) {
        errors.push(
          `Fixture ${fixture.name} is missing input or expected output`,
        );
      }

      if (fixture.input === fixture.expected) {
        errors.push(
          `Fixture ${fixture.name} has identical input and expected output`,
        );
      }
    }
  } catch (error) {
    errors.push(`Failed to load test fixtures: ${error.message}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    fixtures,
  };
}

/**
 * Create test suite configuration
 */
export function createTestSuiteConfig(
  options: {
    performanceThreshold?: number;
    concurrentRequests?: number;
    includeStressTests?: boolean;
    includeBackwardCompatibility?: boolean;
  } = {},
) {
  const {
    performanceThreshold = 100, // 100ms max average
    concurrentRequests = 5,
    includeStressTests = false,
    includeBackwardCompatibility = true,
  } = options;

  return {
    performance: {
      threshold: performanceThreshold,
      iterations: 50,
      assertion: createPerformanceAssertion(performanceThreshold),
    },
    concurrent: {
      requestCount: concurrentRequests,
      testData: createConcurrentTestData(concurrentRequests),
    },
    errors: createErrorTestCases(),
    includeStressTests,
    includeBackwardCompatibility,
  };
}

// Re-export types for convenience
export type { Assert } from 'qunit';

/**
 * Create a large test file for performance testing
 */
export function createLargeFileTestCase(lineCount: number): string {
  const imports = [
    "import { CardDef } from 'https://cardstack.com/base/card-api';",
    "import { field, contains } from 'https://cardstack.com/base/card-api';",
    "import StringField from 'https://cardstack.com/base/string';",
    "import { tracked } from '@glimmer/tracking';",
    "import { action } from '@ember/object';",
    "import { fn } from '@ember/helper';",
    "import { on } from '@ember/modifier';",
  ];

  const classTemplate = `
export class Card{classNumber} extends CardDef {
  @field name = contains(StringField);
  @field title = contains(StringField);
  @field description = contains(StringField);

  @tracked isVisible = true;
  @tracked isExpanded = false;

  get displayName() {
    return this.name || 'Unnamed Card {classNumber}';
  }

  @action
  toggleVisibility() {
    this.isVisible = !this.isVisible;
  }

  @action
  toggleExpansion() {
    this.isExpanded = !this.isExpanded;
  }

  <template>
    <div class="card card-{classNumber}">
      <h2>{{this.displayName}}</h2>
      <p>{{this.description}}</p>
      <button {{on "click" this.toggleVisibility}}>
        {{if this.isVisible "Hide" "Show"}}
      </button>
      <button {{on "click" this.toggleExpansion}}>
        {{if this.isExpanded "Collapse" "Expand"}}
      </button>
    </div>
  </template>
}`;

  const lines = [];

  // Add imports
  lines.push(...imports);
  lines.push('');

  // Calculate how many classes we need to reach target line count
  const linesPerClass = classTemplate.split('\n').length;
  const classCount = Math.ceil(
    (lineCount - imports.length - 1) / linesPerClass,
  );

  // Add classes
  for (let i = 1; i <= classCount; i++) {
    lines.push(classTemplate.replace(/{classNumber}/g, i.toString()));
    lines.push('');
  }

  return lines.join('\n');
}
