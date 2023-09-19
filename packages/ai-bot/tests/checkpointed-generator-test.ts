import { module, test, assert } from 'qunit';
import { CheckpointedAsyncGenerator } from '../helpers';

module('CheckpointedAsyncGenerator', () => {
  // Tests that the CheckpointedAsyncGenerator iterates through the generator and yields expected values
  test('should iterate through the generator and yield expected values', async () => {
    const generator = async function* () {
      yield 1;
      yield 2;
      yield 3;
    };

    const checkpointedGenerator = new CheckpointedAsyncGenerator(generator());

    const result1 = await checkpointedGenerator.next();
    assert.deepEqual(result1, { value: 1, done: false });

    const result2 = await checkpointedGenerator.next();
    assert.deepEqual(result2, { value: 2, done: false });

    const result3 = await checkpointedGenerator.next();
    assert.deepEqual(result3, { value: 3, done: false });

    const result4 = await checkpointedGenerator.next();
    assert.deepEqual(result4, { value: undefined, done: true });
  });

  // Tests that the CheckpointedAsyncGenerator buffers values as expected when checkpointed
  test('should buffer values as expected when checkpointed', async () => {
    const generator = async function* () {
      yield 1;
      yield 2;
      yield 3;
    };

    const checkpointedGenerator = new CheckpointedAsyncGenerator(generator());
    checkpointedGenerator.checkpoint();

    const result1 = await checkpointedGenerator.next();
    assert.deepEqual(result1, { value: 1, done: false });

    const result2 = await checkpointedGenerator.next();
    assert.deepEqual(result2, { value: 2, done: false });

    checkpointedGenerator.checkpoint();

    const result3 = await checkpointedGenerator.next();
    assert.deepEqual(result3, { value: 3, done: false });

    const result4 = await checkpointedGenerator.next();
    assert.deepEqual(result4, { value: undefined, done: true });

    checkpointedGenerator.restore();

    const result5 = await checkpointedGenerator.next();
    assert.deepEqual(result5, { value: 3, done: false });

    const result6 = await checkpointedGenerator.next();
    assert.deepEqual(result6, { value: undefined, done: true });
  });

  // Tests that the CheckpointedAsyncGenerator resets the buffer index as expected when restored
  test('should reset the buffer index as expected when restored', async () => {
    const generator = async function* () {
      yield 1;
      yield 2;
      yield 3;
    };

    const checkpointedGenerator = new CheckpointedAsyncGenerator(generator());
    checkpointedGenerator.checkpoint();

    const result1 = await checkpointedGenerator.next();
    assert.deepEqual(result1, { value: 1, done: false });

    const result2 = await checkpointedGenerator.next();
    assert.deepEqual(result2, { value: 2, done: false });

    const result3 = await checkpointedGenerator.next();
    assert.deepEqual(result3, { value: 3, done: false });

    const result4 = await checkpointedGenerator.next();
    assert.deepEqual(result4, { value: undefined, done: true });

    checkpointedGenerator.restore();

    const result5 = await checkpointedGenerator.next();
    assert.deepEqual(result5, { value: 1, done: false });

    const result6 = await checkpointedGenerator.next();
    assert.deepEqual(result6, { value: 2, done: false });

    const result7 = await checkpointedGenerator.next();
    assert.deepEqual(result7, { value: 3, done: false });

    const result8 = await checkpointedGenerator.next();
    assert.deepEqual(result8, { value: undefined, done: true });
  });

  // Tests that the CheckpointedAsyncGenerator buffers values as expected when checkpointed multiple times
  test('should buffer values as expected when checkpointed multiple times', async () => {
    const generator = async function* () {
      yield 1;
      yield 2;
      yield 3;
    };

    const checkpointedGenerator = new CheckpointedAsyncGenerator(generator());
    checkpointedGenerator.checkpoint();

    const result1 = await checkpointedGenerator.next();
    assert.deepEqual(result1, { value: 1, done: false });

    checkpointedGenerator.checkpoint();

    const result2 = await checkpointedGenerator.next();
    assert.deepEqual(result2, { value: 2, done: false });

    checkpointedGenerator.checkpoint();

    const result3 = await checkpointedGenerator.next();
    assert.deepEqual(result3, { value: 3, done: false });

    const result4 = await checkpointedGenerator.next();
    assert.deepEqual(result4, { value: undefined, done: true });

    checkpointedGenerator.restore();

    const result7 = await checkpointedGenerator.next();
    assert.deepEqual(result7, { value: 3, done: false });

    const result8 = await checkpointedGenerator.next();
    assert.deepEqual(result8, { value: undefined, done: true });
  });

  // Tests that the CheckpointedAsyncGenerator resets the buffer index as expected when restored multiple times
  test('should reset the buffer index as expected when restored multiple times', async () => {
    const generator = async function* () {
      yield 1;
      yield 2;
      yield 3;
    };

    const checkpointedGenerator = new CheckpointedAsyncGenerator(generator());
    checkpointedGenerator.checkpoint();

    const result1 = await checkpointedGenerator.next();
    assert.deepEqual(result1, { value: 1, done: false });

    const result2 = await checkpointedGenerator.next();
    assert.deepEqual(result2, { value: 2, done: false });

    const result3 = await checkpointedGenerator.next();
    assert.deepEqual(result3, { value: 3, done: false });

    const result4 = await checkpointedGenerator.next();
    assert.deepEqual(result4, { value: undefined, done: true });

    checkpointedGenerator.restore();

    const result5 = await checkpointedGenerator.next();
    assert.deepEqual(result5, { value: 1, done: false });

    checkpointedGenerator.restore();

    const result6 = await checkpointedGenerator.next();
    assert.deepEqual(result6, { value: 1, done: false });

    const result7 = await checkpointedGenerator.next();
    assert.deepEqual(result7, { value: 2, done: false });

    const result8 = await checkpointedGenerator.next();
    assert.deepEqual(result8, { value: 3, done: false });

    const result9 = await checkpointedGenerator.next();
    assert.deepEqual(result9, { value: undefined, done: true });
  });

  // Tests that calling return on the CheckpointedAsyncGenerator propagates to the underlying generator
  test('should propagate return to the underlying generator', async () => {
    let isReturnCalled = false;

    const generator = async function* () {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        isReturnCalled = true;
      }
    };

    const checkpointedGenerator = new CheckpointedAsyncGenerator(generator());

    const result1 = await checkpointedGenerator.next();
    assert.deepEqual(result1, { value: 1, done: false });

    const result2 = await checkpointedGenerator.return();
    assert.deepEqual(result2, { value: undefined, done: true });

    assert.true(isReturnCalled);
  });

  test('should restore to the first item if not explicitly checkpointed', async () => {
    const generator = async function* () {
      yield 1;
      yield 2;
      yield 3;
    };

    const checkpointedGenerator = new CheckpointedAsyncGenerator(generator());

    const result1 = await checkpointedGenerator.next();
    assert.deepEqual(result1, { value: 1, done: false });

    checkpointedGenerator.restore();

    const result2 = await checkpointedGenerator.next();
    assert.deepEqual(result2, { value: 1, done: false });
  });
});
