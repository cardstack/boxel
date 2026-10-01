/* eslint-disable n/no-unsupported-features/node-builtins -- workspace Node */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bindHyperframes } from '../dist/hyperframes.js';
import { createChoreoPlayer } from '../dist/index.js';

function fakeRun(duration) {
  let time = 0;
  const run = {
    duration,
    pauseCalls: 0,
    playCalls: 0,
    seekCalls: [],
    speed: 1,
    pause() {
      this.pauseCalls++;
    },
    play() {
      this.playCalls++;
    },
  };
  Object.defineProperty(run, 'time', {
    get: () => time,
    set: (value) => {
      time = value;
      run.seekCalls.push(value);
    },
  });
  return run;
}

function playerOptions(runs, extra = {}) {
  return { runs: () => runs, settle: async () => {}, ...extra };
}

function hyperframesSeek(time) {
  let completion;
  const event = new Event('hf-seek');
  Object.defineProperty(event, 'detail', {
    value: {
      time,
      waitUntil(operation) {
        completion = operation;
      },
    },
  });
  return {
    event,
    get completion() {
      return completion;
    },
  };
}

test('renderAt synchronizes every explicitly owned run', async () => {
  const long = fakeRun(8);
  const short = fakeRun(3);
  const player = createChoreoPlayer(playerOptions([long, short]));

  await player.renderAt(5);

  assert.equal(player.time, 5);
  assert.deepEqual(long.seekCalls, [5]);
  assert.deepEqual(short.seekCalls, [3]);
  assert.equal(long.pauseCalls, 1);
  assert.equal(player.isPlaying, false);
});

test('an explicit composition duration clamps the player', async () => {
  const run = fakeRun(20);
  const player = createChoreoPlayer(playerOptions([run], { duration: 10 }));

  await player.renderAt(99);

  assert.equal(player.duration, 10);
  assert.equal(player.time, 10);
  assert.deepEqual(run.seekCalls, [10]);
});

test('the provider is dynamic and sync seeks newly mounted runs', async () => {
  const first = fakeRun(2);
  const second = fakeRun(4);
  let runs = [first];
  const player = createChoreoPlayer({
    runs: () => runs,
    settle: async () => {},
  });

  player.setPlaybackRate(1.5);
  await player.play();
  runs = [second];
  await player.sync();

  assert.equal(first.playCalls, 1);
  assert.equal(second.playCalls, 1);
  assert.equal(second.speed, 1.5);
  assert.deepEqual(second.seekCalls, [0]);
  assert.equal(player.duration, 4);
});

test('prepare mounts the first run before the initial external seek', async () => {
  const run = fakeRun(6);
  let runs = [];
  let prepareCalls = 0;
  const player = createChoreoPlayer({
    prepare() {
      prepareCalls++;
      runs = [run];
    },
    runs: () => runs,
    settle: async () => {},
  });

  await player.renderAt(2);
  await player.renderAt(3);

  assert.equal(prepareCalls, 1);
  assert.deepEqual(run.seekCalls, [2, 3]);
});

test('renderAt waits for asynchronous run preparation', async () => {
  const run = fakeRun(6);
  let runs = [];
  let finishPreparation;
  const preparation = new Promise((resolve) => {
    finishPreparation = resolve;
  });
  const player = createChoreoPlayer({
    prepare: () => preparation,
    runs: () => runs,
    settle: async () => {},
  });

  let completed = false;
  const rendering = player.renderAt(2).then(() => {
    completed = true;
  });
  await Promise.resolve();

  assert.equal(completed, false);
  assert.deepEqual(run.seekCalls, []);

  runs = [run];
  finishPreparation();
  await rendering;

  assert.deepEqual(run.seekCalls, [2]);
});

test('the latest seek wins while asynchronous preparation is pending', async () => {
  const run = fakeRun(6);
  let runs = [];
  let finishPreparation;
  const preparation = new Promise((resolve) => {
    finishPreparation = resolve;
  });
  const player = createChoreoPlayer({
    prepare: () => preparation,
    runs: () => runs,
    settle: async () => {},
  });

  const first = player.renderAt(2);
  const second = player.renderAt(4);
  runs = [run];
  finishPreparation();
  await Promise.all([first, second]);

  assert.equal(player.time, 4);
  assert.deepEqual(run.seekCalls, [4]);
});

test('play exposes preparation failures', async () => {
  const failure = new Error('score failed to mount');
  const player = createChoreoPlayer({
    prepare: () => Promise.reject(failure),
    runs: () => [],
  });

  await assert.rejects(player.play(), failure);
  assert.equal(player.isPlaying, false);
});

test('bindHyperframes forwards time through waitUntil', async () => {
  const target = new EventTarget();
  const times = [];
  const disconnect = bindHyperframes(
    { renderAt: async (time) => times.push(time) },
    target,
  );
  const seek = hyperframesSeek(2.5);

  target.dispatchEvent(seek.event);
  assert.ok(seek.completion);
  await seek.completion;

  assert.deepEqual(times, [2.5]);
  disconnect();
});

test('bindHyperframes cleanup stops forwarding seeks', async () => {
  const target = new EventTarget();
  const times = [];
  const disconnect = bindHyperframes(
    { renderAt: async (time) => times.push(time) },
    target,
  );
  disconnect();
  const seek = hyperframesSeek(4);

  target.dispatchEvent(seek.event);
  await Promise.resolve();

  assert.equal(seek.completion, undefined);
  assert.deepEqual(times, []);
});

test('bindHyperframes exposes renderer failures to the capture barrier', async () => {
  const target = new EventTarget();
  const failure = new Error('frame reconstruction failed');
  bindHyperframes(
    {
      renderAt: () => {
        throw failure;
      },
    },
    target,
  );
  const seek = hyperframesSeek(1);

  target.dispatchEvent(seek.event);

  await assert.rejects(seek.completion, failure);
});
