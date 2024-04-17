import { type IndexerDBClient, type DBAdapter } from '../index';

export interface SharedTests {
  [testName: string]: (
    assert: Assert,
    client: IndexerDBClient,
    adapter: DBAdapter,
  ) => Promise<void>;
}

export async function runSharedTest(
  tests: SharedTests,
  assert: Assert,
  client: IndexerDBClient,
  adapter: DBAdapter,
) {
  let testName = (assert as any).test.testName as keyof typeof tests;
  let test = tests[testName];
  if (!test) {
    throw new Error(
      `Could not find test "${testName}" in the shared tests module`,
    );
  }
  await test(assert, client, adapter);
}
