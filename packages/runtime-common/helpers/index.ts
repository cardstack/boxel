import { parse } from 'date-fns';

export interface SharedTests<T> {
  [testName: string]: (assert: Assert, args: T) => Promise<void>;
}

export async function runSharedTest<T>(
  tests: SharedTests<T>,
  assert: Assert,
  args: T,
) {
  let testName = (assert as any).test.testName as keyof typeof tests;
  let test = tests[testName];
  if (!test) {
    throw new Error(
      `Could not find test "${testName}" in the shared tests module`,
    );
  }
  await test(assert, args);
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}
