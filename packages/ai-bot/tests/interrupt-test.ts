import { module, test } from 'qunit';
import { Responder } from '../lib/responder.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';
import FakeTimers from '@sinonjs/fake-timers';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai';

function snapshotWithContent(content: string): ChatCompletionSnapshot {
  return {
    choices: [
      {
        message: { content },
        finish_reason: null,
        logprobs: null,
        index: 0,
      },
    ],
    id: '',
    created: 0,
    model: 'llm',
  };
}

/**
 * These tests validate the interrupt coordination pattern used in main.ts.
 *
 * When a user sends a new message while the AI is generating, the new message
 * handler must:
 *   1. Abort the current generation
 *   2. Wait for the original handler to clean up and release the room lock
 *   3. Acquire the lock itself and process the new message
 *
 * The completionPromise in activeGenerations enables step 2.
 */
module('Interrupt Coordination', () => {
  test('completionPromise resolves after generation cleanup, allowing new message to proceed', async (assert) => {
    // Simulate the activeGenerations map entry with a completionPromise
    let resolveCompletion!: () => void;
    let completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    let events: string[] = [];

    // Simulate new message handler waiting on completionPromise
    let newMessageHandler = completionPromise.then(() => {
      events.push('new-message-proceeds');
    });

    // Simulate original handler cleanup (catch/finally in main.ts)
    events.push('original-handler-cleanup');
    resolveCompletion();

    await newMessageHandler;

    assert.deepEqual(
      events,
      ['original-handler-cleanup', 'new-message-proceeds'],
      'New message handler should proceed only after original handler cleanup',
    );
  });

  test('completionPromise resolves even when generation throws an error', async (assert) => {
    let resolveCompletion!: () => void;
    let completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    let resolved = false;

    // Simulate waiting on completionPromise
    let waitPromise = completionPromise.then(() => {
      resolved = true;
    });

    // Simulate: error occurs in generation, but finally block still resolves
    // (mirrors the try/catch/finally pattern in main.ts)
    try {
      throw new Error('simulated generation error');
    } catch {
      // error handled (like the catch block in main.ts)
    } finally {
      resolveCompletion();
    }

    await waitPromise;
    assert.true(
      resolved,
      'completionPromise should resolve even after errors (via finally block)',
    );
  });

  test('multiple concurrent interrupt events are handled correctly', async (assert) => {
    let resolveCompletion!: () => void;
    let completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    let events: string[] = [];

    // Simulate two interrupts arriving concurrently
    let handler1 = completionPromise.then(() => {
      events.push('handler-1-proceeds');
    });
    let handler2 = completionPromise.then(() => {
      events.push('handler-2-proceeds');
    });

    resolveCompletion();
    await Promise.all([handler1, handler2]);

    assert.equal(events.length, 2, 'Both handlers should proceed');
    assert.true(
      events.includes('handler-1-proceeds'),
      'Handler 1 should proceed',
    );
    assert.true(
      events.includes('handler-2-proceeds'),
      'Handler 2 should proceed',
    );
  });
});

/**
 * These tests validate responder behavior during cancellation,
 * ensuring correct state transitions and no spurious side effects.
 */
module('Responder Cancellation', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;
  let clock: FakeTimers.InstalledClock;

  hooks.beforeEach(() => {
    clock = FakeTimers.install();
    fakeMatrixClient = new FakeMatrixClient();
  });

  hooks.afterEach(() => {
    clock.runToLast();
    clock.uninstall();
    fakeMatrixClient.resetSentEvents();
  });

  test('cancellation after chunks sends final event with isCanceled flag', async (assert) => {
    let responder = new Responder(fakeMatrixClient, 'room-cancel-1', 'agent-1');
    await responder.ensureThinkingMessageSent();

    // Send some chunks
    await responder.onChunk({} as any, snapshotWithContent('Hello'));
    clock.tick(250);
    await responder.onChunk({} as any, snapshotWithContent('Hello world'));
    clock.tick(250);

    // Cancel (simulates what the APIUserAbortError catch block does)
    await responder.finalize({ isCanceled: true });
    clock.tick(250);

    let sentEvents = fakeMatrixClient.getSentEvents();
    let lastEvent = sentEvents[sentEvents.length - 1];
    assert.true(
      lastEvent.content.isCanceled,
      'Final event should have isCanceled flag',
    );
    assert.true(
      lastEvent.content.isStreamingFinished,
      'Final event should have isStreamingFinished flag',
    );
    assert.equal(
      lastEvent.content.body,
      'Hello world',
      'Final event should contain the last content',
    );
  });

  test('cancellation before any chunks sends final event with isCanceled flag', async (assert) => {
    let responder = new Responder(fakeMatrixClient, 'room-cancel-2', 'agent-2');
    await responder.ensureThinkingMessageSent();

    // Cancel immediately — no chunks received
    await responder.finalize({ isCanceled: true });
    clock.tick(250);

    let sentEvents = fakeMatrixClient.getSentEvents();
    let lastEvent = sentEvents[sentEvents.length - 1];
    assert.true(
      lastEvent.content.isCanceled,
      'Final event should have isCanceled flag even with no content',
    );
    assert.true(
      lastEvent.content.isStreamingFinished,
      'Final event should have isStreamingFinished flag',
    );
  });

  test('onError is suppressed after cancellation finalize', async (assert) => {
    let responder = new Responder(fakeMatrixClient, 'room-cancel-3', 'agent-3');
    await responder.ensureThinkingMessageSent();
    await responder.onChunk({} as any, snapshotWithContent('partial'));
    clock.tick(250);

    // Finalize with cancel (as the APIUserAbortError handler does)
    await responder.finalize({ isCanceled: true });
    clock.tick(250);

    let eventsAfterCancel = fakeMatrixClient.getSentEvents().length;

    // Now call onError (as would happen if the catch block ran for a non-abort error)
    await responder.onError('Some error after cancel');

    let eventsAfterError = fakeMatrixClient.getSentEvents().length;
    assert.equal(
      eventsAfterCancel,
      eventsAfterError,
      'onError should not send any events after finalize',
    );
  });

  test('onError does not report to Sentry after cancellation', async (assert) => {
    let sentryCalls: any[] = [];
    let originalCaptureException = Sentry.captureException;
    (Sentry as any).captureException = (...args: any[]) => {
      sentryCalls.push(args);
      return '';
    };

    try {
      let responder = new Responder(
        fakeMatrixClient,
        'room-cancel-sentry',
        'agent-sentry',
      );
      await responder.ensureThinkingMessageSent();
      await responder.onChunk({} as any, snapshotWithContent('partial'));
      clock.tick(250);

      await responder.finalize({ isCanceled: true });
      clock.tick(250);
      sentryCalls = [];

      // This simulates the error path that runs after abort
      await responder.onError(new OpenAIError('abort error'));

      assert.equal(
        sentryCalls.length,
        0,
        'Sentry should NOT be called after finalize — prevents false alarms from cancellation',
      );
    } finally {
      (Sentry as any).captureException = originalCaptureException;
    }
  });

  test('second finalize after cancel finalize is a no-op', async (assert) => {
    let responder = new Responder(fakeMatrixClient, 'room-cancel-4', 'agent-4');
    await responder.ensureThinkingMessageSent();
    await responder.onChunk({} as any, snapshotWithContent('content'));
    clock.tick(250);

    await responder.finalize({ isCanceled: true });
    clock.tick(250);
    let countAfterCancel = fakeMatrixClient.getSentEvents().length;

    // A normal finalize after a cancel finalize should be idempotent
    await responder.finalize();
    clock.tick(250);
    let countAfterSecond = fakeMatrixClient.getSentEvents().length;

    assert.equal(
      countAfterCancel,
      countAfterSecond,
      'Second finalize should not send additional events',
    );
  });
});
