import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import {
  acceptProposal,
  claimedBump,
  listProposals,
  proposeVersion,
  withdrawProposal,
} from '../lib/package-proposals.ts';

const V1 = `export const VERSION = '1.0.0';
const COLORS = ['#a', '#b', '#c'];
export function pick(n) { return COLORS[n % COLORS.length]; }`;

const V2 = `export const VERSION = '2.0.0';
const COLORS = { red: '#a' };
export function pick(name) { return COLORS[name] ?? null; }
export function names() { return Object.keys(COLORS); }`;

const REMOVED = `export const VERSION = '2.0.0';
export function names() { return []; }`;

async function withStore(fn: (dir: string) => Promise<void>) {
  let dir = await mkdtemp(join(tmpdir(), 'proposals-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const META = { versions: { '1.0.0': { treeHash: 'aa', storage: 'blobs-v1' } } };

module(basename(import.meta.filename), function () {
  module('publishing in two phases', function () {
    test('a proposal is not a Version', async function (assert) {
      // The safety property the whole split rests on: proposing changes
      // nothing anyone can resolve. Nothing is written to `versions`, so a
      // proposal that is never accepted leaves the served world untouched.
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '2.0.0',
          treeHash: 'bb',
          body: 'pick() now takes a name.',
          proposedBy: 'chris',
          meta: META,
        });
        assert.strictEqual(p.state, 'open', 'it starts open');
        assert.deepEqual(
          Object.keys(META.versions),
          ['1.0.0'],
          'the store still holds only what it held before',
        );
      });
    });

    test('the gate refusal is recorded, not thrown away', async function (assert) {
      // A proposal the gate would refuse is exactly the one worth reviewing.
      // Discarding it hides the case review exists for.
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: 'not-a-version',
          treeHash: 'bb',
          body: 'oops',
          proposedBy: 'chris',
          meta: META,
        });
        assert.strictEqual(p.gate.kind, 'refused', 'the verdict is on record');
        let accepted = await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
        });
        assert.strictEqual(
          accepted.kind === 'refused' && accepted.code,
          'gate-refused',
          'and it still blocks acceptance',
        );
      });
    });

    test('accepting below the structural floor demands a reason', async function (assert) {
      // THE CASE THE RULING EXISTS FOR. `pick` loses an export here, so the
      // structural pass says major; the proposer claims 1.1.0, a minor. That
      // is the bump nobody checks today, and it would ship a break to every
      // consumer on `^1.0.0`.
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '1.1.0',
          treeHash: 'bb',
          body: 'tidy up',
          proposedBy: 'chris',
          priorSource: V1,
          candidateSource: REMOVED,
          priorVersion: '1.0.0',
          meta: META,
        });
        assert.strictEqual(p.delta?.bump, 'major', 'the pass saw the removal');

        let refused = await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
        });
        assert.strictEqual(
          refused.kind === 'refused' && refused.code,
          'override-needs-reason',
          'it cannot be waved through silently',
        );

        // Allowed, because the pass is imperfect and a human may know better
        // — but the reason lands in the record for whoever meets the break.
        let accepted = await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
          overrideReason: 'pick was never exported in a released build',
        });
        assert.strictEqual(accepted.kind, 'accepted');
        assert.strictEqual(
          accepted.kind === 'accepted' && accepted.proposal.overrideReason,
          'pick was never exported in a released build',
          'and the reason is kept, not just consumed',
        );
      });
    });

    test('a claim at or above the suggestion goes straight through', async function (assert) {
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '2.0.0',
          treeHash: 'bb',
          body: 'pick() now takes a name.',
          proposedBy: 'chris',
          priorSource: V1,
          candidateSource: V2,
          priorVersion: '1.0.0',
          meta: META,
        });
        // Worth being explicit that the pass UNDERSTATES here: v1's
        // pick(index) became v2's pick(name), same arity, so structurally it
        // reads minor. The proposer claimed major, which is above the floor
        // and therefore needs no justification. This is the asymmetry working
        // — over-claiming is always free.
        assert.strictEqual(
          p.delta?.bump,
          'minor',
          'the pass sees only additions',
        );
        let accepted = await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
        });
        assert.strictEqual(accepted.kind, 'accepted');
      });
    });

    test('a proposal is accepted once', async function (assert) {
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '2.0.0',
          treeHash: 'bb',
          body: 'x',
          proposedBy: 'chris',
          meta: META,
        });
        await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
        });
        let again = await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
        });
        assert.strictEqual(again.kind === 'refused' && again.code, 'not-open');
      });
    });

    test('withdrawing takes it out of the queue without deleting the record', async function (assert) {
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '2.0.0',
          treeHash: 'bb',
          body: 'x',
          proposedBy: 'chris',
          meta: META,
        });
        assert.true(await withdrawProposal(dir, 'lib/palette', p.id));
        let queue = await listProposals(dir, 'lib/palette');
        assert.strictEqual(queue[0]?.state, 'withdrawn', 'still readable');
      });
    });

    test('the claimed bump is read off the numbers, not taken on trust', async function (assert) {
      assert.strictEqual(claimedBump('1.0.0', '2.0.0'), 'major');
      assert.strictEqual(claimedBump('1.0.0', '1.1.0'), 'minor');
      assert.strictEqual(claimedBump('1.0.0', '1.0.1'), 'patch');
      assert.strictEqual(claimedBump('1.0.0', 'nonsense'), undefined);
    });
  });
});
