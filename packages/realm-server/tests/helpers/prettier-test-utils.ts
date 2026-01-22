// Test utilities for prettier formatting tests
import { performance } from 'perf_hooks';

interface FormattingTestCase {
  name: string;
  input: string;
  expected: string;
  cardDescription: string;
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
 * Performance benchmark interface
 */
interface PerformanceBenchmark {
  name: string;
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
interface ComparisonResult {
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
  cardDescription: string;
}

/**
 * Main test utilities class for infrastructure
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
      duration,
      iterations,
      averageTime,
      maxTime,
      minTime,
      result: lastResult!,
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
   * Create concurrent test data for performance testing
   */
  createConcurrentTestData(count: number): FormattingTestCase[] {
    const testCases: FormattingTestCase[] = [];

    for (let i = 0; i < count; i++) {
      testCases.push({
        name: `concurrent-test-${i}`,
        input: `import{CardDef}from'somewhere${i}';export class Test${i} extends CardDef{@field name=contains(StringField);}`,
        expected: `import { CardDef } from 'somewhere${i}';\n\nexport class Test${i} extends CardDef {\n  @field name = contains(StringField);\n}`,
        cardDescription: `Concurrent test case ${i}`,
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
        cardDescription: 'Test handling of invalid syntax',
      },
      {
        name: 'malformed-template',
        input: '<template>\n  <div>\n    <span>unclosed\n  </div>\n</template>',
        expectedError: 'TemplateError',
        cardDescription: 'Test handling of malformed template',
      },
      {
        name: 'missing-imports',
        input:
          'export class Test extends CardDef {\n  @field name = contains(StringField);\n}',
        expectedError: 'ReferenceError',
        cardDescription: 'Test handling of missing imports',
      },
    ];
  }
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
  cardDescription: string;
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
      cardDescription: `Concurrent test ${i}`,
      expectedOutput,
    });
  }

  return testData;
}

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
