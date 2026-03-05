import {
  branchNameToSubmissionMeta,
  toBranchName,
} from '../github-submissions';
import type { SharedTests } from '../helpers';

const tests = Object.freeze({
  'it converts a branch name back to a matrix room id': async (assert) => {
    let branchName = 'room-IUZFZGlxWXRoRW52WU51QmlnbTpib3hlbC5haQ';
    assert.deepEqual(branchNameToSubmissionMeta(branchName), {
      matrixRoomId: '!FEdiqYthEnvYNuBigm:boxel.ai',
    });
  },

  'it extracts the room id from a branch name with a suffix': async (
    assert,
  ) => {
    let roomId = '!NVeTCArRGAqTnFzcPU:stack.cards';
    let roomPrefix = toBranchName(roomId, 'seed').split('/')[0];
    let branchName = `${roomPrefix}/my-feature`;
    assert.strictEqual(
      branchNameToSubmissionMeta(branchName).matrixRoomId,
      roomId,
    );
  },

  'it builds a branch name from a room id and listing name': async (assert) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    assert.strictEqual(
      toBranchName(roomId, 'SomeSampleListing'),
      'room-IVhlekVEcVVsSUpjTmRzdWFGQjpsb2NhbGhvc3Q/some-sample-listing',
    );
  },

  'it normalizes listing names with spaces and punctuation': async (assert) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    let roomPrefix = toBranchName(roomId, 'seed').split('/')[0];
    assert.strictEqual(
      toBranchName(roomId, '  My  New Listing  '),
      `${roomPrefix}/my-new-listing`,
    );
    assert.strictEqual(
      toBranchName(roomId, 'Weird---Name!!'),
      `${roomPrefix}/weird-name`,
    );
  },

  'it normalizes camelcase listing names': async (assert) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    let roomPrefix = toBranchName(roomId, 'seed').split('/')[0];
    assert.strictEqual(
      toBranchName(roomId, 'CamelCaseListing'),
      `${roomPrefix}/camel-case-listing`,
    );
  },

  'it drops the listing segment when the slug is empty': async (assert) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    let roomPrefix = toBranchName(roomId, 'seed').split('/')[0];
    assert.strictEqual(toBranchName(roomId, '   '), roomPrefix);
  },

  'it rejects missing listing names when building branch names': async (
    assert,
  ) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    assert.throws(() => toBranchName(roomId, ''), /listingName is required/);
  },

  'it can invert a branch name into room id and listing name': async (
    assert,
  ) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    let branchName = toBranchName(roomId, 'SomeSampleListing');
    let result = branchNameToSubmissionMeta(branchName);
    assert.strictEqual(result.matrixRoomId, roomId);
    assert.strictEqual(result.listingName, 'some-sample-listing');
  },

  'it rejects branch names without the prefix': async (assert) => {
    assert.throws(
      () => branchNameToSubmissionMeta('feature/room-abc'),
      /matrix room id prefix/,
    );
  },

  'it rejects branch names with an invalid encoded room id': async (assert) => {
    assert.throws(
      () => branchNameToSubmissionMeta('room-@@@'),
      /invalid encoded matrix room id/,
    );
  },
} as SharedTests<Record<string, never>>);

export default tests;
