import {
  afterAll as vitestAfterAll,
  afterEach as vitestAfterEach,
  beforeAll as vitestBeforeAll,
  beforeEach as vitestBeforeEach,
} from 'vitest';

type HookCallback = () => void | Promise<void>;

export type NestedHooksLike = {
  before(fn: HookCallback): void;
  after(fn: HookCallback): void;
  beforeEach(fn: HookCallback): void;
  afterEach(fn: HookCallback): void;
};

export function createVitestNestedHooksAdapter(): NestedHooksLike {
  return {
    before(fn) {
      vitestBeforeAll(async () => {
        await fn();
      });
    },
    after(fn) {
      vitestAfterAll(async () => {
        await fn();
      });
    },
    beforeEach(fn) {
      vitestBeforeEach(async () => {
        await fn();
      });
    },
    afterEach(fn) {
      vitestAfterEach(async () => {
        await fn();
      });
    },
  };
}
