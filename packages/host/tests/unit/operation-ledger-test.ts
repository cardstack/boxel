import { module, test } from 'qunit';

import {
  Deferred,
  OperationsError,
  stampBaseVersion,
  writeResultIn,
} from '@cardstack/runtime-common';

import type {
  OperationsAnswer,
  OperationsEnvelope,
} from '@cardstack/runtime-common';

import OperationLedger from '@cardstack/host/lib/operation-ledger';
import type {
  LedgerEnvironment,
  LoweredOperation,
} from '@cardstack/host/lib/operation-ledger';

import type { CardDef } from '@cardstack/base/card-api';

// ============================================================================
// The ledger's own rules, without a realm.
//
// What is under test here is policy and nothing else: the order operations are
// applied and sent in, which version each one names as its base, what counts
// as the realm confirming a result, and what happens to the operations queued
// behind one that did not work out. Every collaborator is a stand-in, so a
// test can hold a response open and inspect the state in between — which is
// the only way to say "applied before the realm answered" as an assertion
// rather than as a hope about timing.
//
// The realm's half of the same behavior is covered against a running realm in
// `tests/integration/operations-optimistic-test.ts`. This file exists because
// the cases that matter most here — a base the realm moved past, a refusal
// part-way down a queue, a foreign write arriving mid-flight — are all races,
// and driving them through a real realm would mean provoking a race rather
// than stating one.
// ============================================================================

const REALM = 'http://test-realm/test/';
const CARD = `${REALM}report`;

interface Sent {
  envelope: OperationsEnvelope;
  clientRequestId: string;
  answer: Deferred<OperationsAnswer>;
}

interface Harness {
  ledger: OperationLedger;
  env: LedgerEnvironment;
  instance: CardDef;
  // Every send the ledger has made, in the order it made them, each holding a
  // deferred the test settles when it wants that round trip to finish.
  sends: Sent[];
  applied: { params: Record<string, unknown> | undefined }[];
  reloads: number;
  recorded: string[];
  // Fires the store's reload notification, which is what a foreign write looks
  // like from the ledger's side.
  foreignWrite(): void;
  attempt(
    params?: Record<string, unknown>,
  ): Promise<OperationsAnswer | undefined>;
}

function deterministicTransform(): LoweredOperation {
  return {
    deterministic: true,
    program: {
      source: 'append(.comments; {body: params("body")});',
      syntax: 'solidified',
    },
  };
}

function answerWith(meta: Record<string, unknown>): OperationsAnswer {
  return {
    'atomic:results': [{ data: { type: 'card', id: CARD, meta } }],
  } as OperationsAnswer;
}

function setup(
  overrides: Partial<LedgerEnvironment> & { version?: string } = {},
): Harness {
  let instance = { id: CARD } as unknown as CardDef;
  let sends: Sent[] = [];
  let applied: Harness['applied'] = [];
  let reloadSubscribers: ((instance: CardDef) => void)[] = [];
  let harness = {
    instance,
    sends,
    applied,
    reloads: 0,
    recorded: [] as string[],
  } as Harness;
  let heldVersion = overrides.version;

  let env: LedgerEnvironment = {
    held: () => instance,
    localId: () => 'local-1',
    lower: async () => deterministicTransform(),
    applyLocally: async (_instance, _operation, params) => {
      applied.push({ params });
    },
    reload: async () => {
      harness.reloads++;
    },
    heldVersion: () => heldVersion,
    recordVersion: (_instance, version) => {
      heldVersion = version;
      harness.recorded.push(version);
    },
    withLock: async (_localId, fn) => await fn(),
    send: async (_realmURL, envelope, clientRequestId) => {
      let answer = new Deferred<OperationsAnswer>();
      sends.push({ envelope, clientRequestId, answer });
      return await answer.promise;
    },
    stamp: stampBaseVersion,
    writeResult: writeResultIn,
    onReload: (cb) => {
      reloadSubscribers.push(cb);
      return () => {
        reloadSubscribers = reloadSubscribers.filter((s) => s !== cb);
      };
    },
    ...overrides,
  };

  harness.env = env;
  harness.ledger = new OperationLedger(env);
  harness.foreignWrite = () => {
    for (let subscriber of [...reloadSubscribers]) {
      subscriber(instance);
    }
  };
  let calls = 0;
  harness.attempt = (params) =>
    harness.ledger.attempt({
      realmURL: REALM,
      envelope: {
        'boxel:operations': [
          {
            op: 'invoke',
            'boxel:name': 'addComment',
            href: CARD,
            ...(params ? { data: params } : {}),
          },
        ],
      },
      candidate: {
        id: CARD,
        name: 'addComment',
        ...(params ? { params } : {}),
      },
      clientRequestId: `instance:${++calls}`,
    });
  return harness;
}

// The base version an envelope names, or undefined when it names none.
function baseVersionOf(envelope: OperationsEnvelope): unknown {
  let [entry] = envelope['boxel:operations'];
  let data = (entry as { data?: Record<string, unknown> }).data;
  return (data?.meta as Record<string, unknown> | undefined)?.baseVersion;
}

// Lets the ledger's chains run to a standstill.
//
// A macrotask boundary rather than a count of microtask ticks: preparing an
// entry awaits the lowering and the local application, and each entry's
// preparation is chained behind the one before it, so the number of ticks
// three queued operations need is a property of the implementation. Yielding
// to the task queue drains whatever is pending however deep it goes, which is
// what the assertions actually mean by "once everything settles".
async function drain() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// The error a promise rejected with. A rejection this suite reads members off
// rather than matches a message against: `OperationsError`'s message is built
// from the realm's title and detail, so the code — which is what a caller
// branches on — never appears in it.
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the operation to reject, and it resolved');
}

module('Unit | operation ledger', function () {
  test('the operation is applied locally before the realm answers', async function (assert) {
    let h = setup();
    let call = h.attempt({ body: 'first' });
    await drain();

    assert.strictEqual(h.applied.length, 1, 'the program ran locally');
    assert.deepEqual(
      h.applied[0].params,
      { body: 'first' },
      'it ran with the payload the call carried',
    );
    assert.strictEqual(h.sends.length, 1, 'and the write is in flight');

    h.sends[0].answer.fulfill(answerWith({ version: 'v2', baseMatched: true }));
    await call;
  });

  test('a matched base retires the entry without re-reading the card', async function (assert) {
    let h = setup({ version: 'v1' });
    let call = h.attempt({ body: 'first' });
    await drain();

    assert.strictEqual(
      baseVersionOf(h.sends[0].envelope),
      'v1',
      'the write names the version the card was known to hold',
    );
    h.sends[0].answer.fulfill(answerWith({ version: 'v2', baseMatched: true }));
    await call;

    assert.strictEqual(h.reloads, 0, 'nothing was re-read');
    assert.deepEqual(
      h.recorded,
      ['v2'],
      'the version the write reported was recorded',
    );
  });

  test('a base the realm has moved past re-reads the card', async function (assert) {
    let h = setup({ version: 'v1' });
    let call = h.attempt({ body: 'first' });
    await drain();

    h.sends[0].answer.fulfill(
      answerWith({ version: 'v9', baseMatched: false }),
    );
    // The write itself landed — a moved base is not a refusal — so the call
    // that made it still succeeds.
    await call;

    assert.strictEqual(h.reloads, 1, 'the card was re-read');
    assert.deepEqual(
      h.recorded,
      [],
      'and no version was recorded, since local state is not what the realm holds',
    );
  });

  test('a realm that reports no baseMatched is not treated as confirmation', async function (assert) {
    // The shape a card this tab has only read produces today: no version to
    // name, so nothing for the realm to compare, so no answer. Reading that
    // silence as agreement is the one failure here with no symptom.
    let h = setup();
    let call = h.attempt({ body: 'first' });
    await drain();

    assert.strictEqual(
      baseVersionOf(h.sends[0].envelope),
      undefined,
      'no base was named',
    );
    h.sends[0].answer.fulfill(answerWith({ version: 'v2' }));
    await call;

    assert.strictEqual(
      h.reloads,
      1,
      'the card was re-read rather than trusted',
    );
  });

  test('queued operations send in order, each naming its predecessor’s version', async function (assert) {
    let h = setup({ version: 'v1' });
    let first = h.attempt({ body: 'one' });
    let second = h.attempt({ body: 'two' });
    let third = h.attempt({ body: 'three' });
    await drain();

    assert.strictEqual(
      h.applied.length,
      3,
      'all three are applied locally at once, so the card shows all of them',
    );
    assert.strictEqual(h.sends.length, 1, 'while only the first is in flight');
    assert.strictEqual(baseVersionOf(h.sends[0].envelope), 'v1');

    h.sends[0].answer.fulfill(answerWith({ version: 'v2', baseMatched: true }));
    await first;
    await drain();
    assert.strictEqual(h.sends.length, 2, 'the second follows the first');
    assert.strictEqual(
      baseVersionOf(h.sends[1].envelope),
      'v2',
      'and names what the first write returned',
    );

    h.sends[1].answer.fulfill(answerWith({ version: 'v3', baseMatched: true }));
    await second;
    await drain();
    assert.strictEqual(baseVersionOf(h.sends[2].envelope), 'v3');

    h.sends[2].answer.fulfill(answerWith({ version: 'v4', baseMatched: true }));
    await third;
    assert.strictEqual(h.reloads, 0, 'a clean chain re-reads nothing');
  });

  test('a failure aborts the operations queued behind it', async function (assert) {
    let h = setup({ version: 'v1' });
    let first = h.attempt({ body: 'one' });
    let second = h.attempt({ body: 'two' });
    let third = h.attempt({ body: 'three' });
    await drain();

    h.sends[0].answer.fulfill(answerWith({ version: 'v2', baseMatched: true }));
    await first;
    await drain();

    h.sends[1].answer.reject(
      new OperationsError({
        status: 400,
        code: 'assertion-failed',
        title: 'Assertion failed',
        detail: 'the status is not open',
      }),
    );
    let secondError = await rejection(second);
    assert.strictEqual(
      (secondError as OperationsError).code,
      'assertion-failed',
      'the failing one reports its own error',
    );

    let thirdError = await rejection(third);
    assert.true(
      thirdError instanceof OperationsError,
      'the one queued behind it is rejected',
    );
    assert.strictEqual(
      (thirdError as OperationsError).code,
      'preceding-operation-failed',
      'and says why, rather than reporting a failure of its own',
    );
    assert.strictEqual(
      h.sends.length,
      2,
      'the third was never sent, so nothing was written for it',
    );
    assert.strictEqual(h.reloads, 1, 'the card was re-read once');
  });

  test('a fresh operation after a cascade is carried normally', async function (assert) {
    // The chain has to come back. An abort cancels what was queued behind the
    // failure, and if the ledger remembered that as a property of the card
    // rather than of those entries, the next operation — invoked after the
    // re-read, against state the realm agrees with — would be refused for a
    // failure that is over.
    let h = setup({ version: 'v1' });
    let first = h.attempt({ body: 'one' });
    let second = h.attempt({ body: 'two' });
    await drain();

    h.sends[0].answer.reject(
      new OperationsError({
        status: 400,
        code: 'assertion-failed',
        title: 'Assertion failed',
        detail: 'the status is not open',
      }),
    );
    assert.strictEqual(
      ((await rejection(first)) as OperationsError).code,
      'assertion-failed',
    );
    assert.strictEqual(
      ((await rejection(second)) as OperationsError).code,
      'preceding-operation-failed',
    );
    await drain();

    let third = h.attempt({ body: 'three' });
    await drain();

    assert.strictEqual(
      h.sends.length,
      2,
      'the next operation is sent rather than refused',
    );
    h.sends[1].answer.fulfill(answerWith({ version: 'v5', baseMatched: true }));
    let answer = await third;
    assert.ok(answer, 'and it resolves with the realm’s answer');
  });

  test('a foreign write re-applies the operations that have not been sent', async function (assert) {
    let h = setup({ version: 'v1' });
    let first = h.attempt({ body: 'one' });
    h.attempt({ body: 'two' });
    await drain();

    assert.strictEqual(h.applied.length, 2);
    assert.strictEqual(h.sends.length, 1, 'only the first is in flight');

    // Someone else wrote the card; the store re-read it, so every local effect
    // went with it.
    h.foreignWrite();
    await drain();

    assert.strictEqual(
      h.applied.length,
      3,
      'the unsent operation is applied again on top of the fresh source',
    );
    assert.deepEqual(
      h.applied[2].params,
      { body: 'two' },
      'and it is the unsent one that was re-applied, not the one in flight',
    );

    h.sends[0].answer.fulfill(answerWith({ version: 'v2', baseMatched: true }));
    await first;
    await drain();
    assert.strictEqual(
      baseVersionOf(h.sends[1].envelope),
      'v2',
      'the next write names the version the realm last reported',
    );
  });

  test('a program that is not deterministic is declined', async function (assert) {
    let h = setup({
      lower: async () => ({
        deterministic: false,
        program: { source: 'set(.at; NOW());', syntax: 'solidified' as const },
      }),
    });
    let answer = await h.attempt({ body: 'one' });

    assert.strictEqual(answer, undefined, 'the ledger declines to carry it');
    assert.strictEqual(h.applied.length, 0, 'nothing was applied locally');
    assert.strictEqual(h.sends.length, 0, 'and nothing was sent from here');
  });

  test('a program that cannot run locally is declined with nothing applied', async function (assert) {
    // What a program reading a computed field does: the realm answers it from
    // an index overlay this client does not have, so it refuses here.
    let h = setup({
      applyLocally: async () => {
        throw new Error('read of a value the realm supplies');
      },
    });
    let answer = await h.attempt({ body: 'one' });

    assert.strictEqual(answer, undefined, 'the ledger declines to carry it');
    assert.strictEqual(h.sends.length, 0, 'and nothing was sent from here');
    assert.strictEqual(h.reloads, 0, 'there is nothing to put right');
  });

  test('a failure while deciding eligibility declines rather than fails the call', async function (assert) {
    // Working out whether this *can* be optimistic is not work the caller
    // asked for, so a failure in it must not become a failure of their
    // operation — it costs them the pessimistic path they would have taken.
    let h = setup({
      lower: async () => {
        throw new Error('the type could not be resolved');
      },
    });
    let answer = await h.attempt({ body: 'one' });

    assert.strictEqual(answer, undefined, 'the ledger declines to carry it');
    assert.strictEqual(h.applied.length, 0, 'nothing was applied locally');
    assert.strictEqual(h.sends.length, 0, 'and nothing was sent from here');
  });

  test('a card this session is not holding is declined', async function (assert) {
    let h = setup({ held: () => undefined });
    let answer = await h.attempt({ body: 'one' });

    assert.strictEqual(answer, undefined);
    assert.strictEqual(h.applied.length, 0);
    assert.strictEqual(h.sends.length, 0);
  });
});
