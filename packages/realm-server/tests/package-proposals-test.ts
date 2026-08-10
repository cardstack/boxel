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
  readProposal,
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

const META = {
  versions: { '1.0.0': { treeHash: 'aa', storage: 'blobs-v1' } },
} as const;

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
          accepted.kind === 'refused' ? accepted.code : accepted.kind,
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
          refused.kind === 'refused' ? refused.code : refused.kind,
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
          accepted.kind === 'accepted'
            ? accepted.proposal.overrideReason
            : undefined,
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

    test('a claim that does not follow its baseline is asked about', async function (assert) {
      // The gap a live demo found: claim 1.2.3 while 4.0.0 is the current
      // Version. Every existing check passes it — 1.2.3 is a valid semver
      // nobody has published — and the structural verdict on record was
      // computed against 4.0.0, describing a delta this claim is not making.
      // So without this it publishes with nothing having checked the number.
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '1.2.3',
          treeHash: 'bb',
          body: 'a backport, or a typo',
          proposedBy: 'chris',
          priorSource: V1,
          candidateSource: V2,
          priorVersion: '4.0.0',
          meta: META,
        });
        let refused = await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
        });
        assert.strictEqual(
          refused.kind === 'refused' ? refused.code : refused.kind,
          'claim-does-not-follow',
        );
        // Allowed with a reason, because publishing onto an older line is a
        // real thing to do — it just may not pass silently.
        let accepted = await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: p.id,
          acceptedBy: 'reviewer',
          overrideReason: 'backporting the fix to the 1.x line',
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
        assert.strictEqual(
          again.kind === 'refused' ? again.code : again.kind,
          'not-open',
        );
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

    test('the effect runs after the checks, and a failed one leaves it open', async function (assert) {
      // Publishing is the thing that makes a Version exist, so its ordering
      // against the checks is the whole safety property. Two facts here: the
      // refused proposal never reaches `commit` at all, and a `commit` that
      // throws leaves nothing marked — which is the state a retry proceeds
      // from.
      await withStore(async (dir) => {
        let ran: string[] = [];
        let refusable = await proposeVersion({
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
        await acceptProposal({
          storeDir: dir,
          name: 'lib/palette',
          id: refusable.id,
          acceptedBy: 'reviewer',
          commit: async () => {
            ran.push('published');
          },
        });
        assert.deepEqual(ran, [], 'a refused acceptance never publishes');

        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '2.0.0',
          treeHash: 'bb',
          body: 'x',
          proposedBy: 'chris',
          meta: META,
        });
        await assert.rejects(
          acceptProposal({
            storeDir: dir,
            name: 'lib/palette',
            id: p.id,
            acceptedBy: 'reviewer',
            commit: async () => {
              throw new Error('disk full');
            },
          }),
          /disk full/,
          'the publish failure surfaces as itself',
        );
        let stored = await readProposal(dir, 'lib/palette', p.id);
        assert.strictEqual(
          stored?.state,
          'open',
          'and the proposal is still open, not accepted for a Version nobody has',
        );
      });
    });

    test('the proposal carries the bytes it is a claim about', async function (assert) {
      // Without this, acceptance would have to be re-supplied the source by
      // whoever clicked accept, and nothing would tie it to the diff the
      // reviewer read.
      await withStore(async (dir) => {
        let p = await proposeVersion({
          storeDir: dir,
          name: 'lib/palette',
          version: '2.0.0',
          treeHash: 'bb',
          body: 'x',
          proposedBy: 'chris',
          priorSource: V1,
          candidateSource: V2,
          priorVersion: '1.0.0',
          meta: META,
        });
        assert.strictEqual(p.source, V2);
        let stored = await readProposal(dir, 'lib/palette', p.id);
        assert.strictEqual(stored?.source, V2, 'and it survives a round trip');
      });
    });

    test('the claimed bump is read off the numbers, not taken on trust', async function (assert) {
      assert.strictEqual(claimedBump('1.0.0', '2.0.0'), 'major');
      assert.strictEqual(claimedBump('1.0.0', '1.1.0'), 'minor');
      assert.strictEqual(claimedBump('1.0.0', '1.0.1'), 'patch');
      assert.strictEqual(claimedBump('1.0.0', 'nonsense'), undefined);
      // Not an increment at all. Read component-by-component this looks like a
      // minor (2 > 0), which would grade a backwards claim against a
      // suggestion computed for a line it does not extend.
      assert.strictEqual(claimedBump('4.0.0', '1.2.3'), undefined);
      assert.strictEqual(claimedBump('1.0.0', '1.0.0'), undefined);
    });
  });
});
