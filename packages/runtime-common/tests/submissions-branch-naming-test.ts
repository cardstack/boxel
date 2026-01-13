import {
  branchNameToMatrixRoomId,
  matrixRoomIdToBranchName,
  toBranchName,
} from '../github-webhook';
import type { SharedTests } from '../helpers';

const tests = Object.freeze({
  'it converts a matrix room id to a branch name': async (assert) => {
    let roomId = '!pEmAAmuYuyPRnciXVu:localhost';
    assert.strictEqual(
      matrixRoomIdToBranchName(roomId),
      'room-IXBFbUFBbXVZdXlQUm5jaVhWdTpsb2NhbGhvc3Q',
    );
  },

  'it converts a branch name back to a matrix room id': async (assert) => {
    let branchName = 'room-IUZFZGlxWXRoRW52WU51QmlnbTpib3hlbC5haQ';
    assert.strictEqual(
      branchNameToMatrixRoomId(branchName),
      '!FEdiqYthEnvYNuBigm:boxel.ai',
    );
  },

  'it extracts the room id from a branch name with a suffix': async (
    assert,
  ) => {
    let roomId = '!NVeTCArRGAqTnFzcPU:stack.cards';
    let branchName = `${matrixRoomIdToBranchName(roomId)}/my-feature`;
    assert.strictEqual(branchNameToMatrixRoomId(branchName), roomId);
  },

  'it builds a branch name from a room id and listing name': async (
    assert,
  ) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    assert.strictEqual(
      toBranchName(roomId, 'SomeSampleListing'),
      'room-IVhlekVEcVVsSUpjTmRzdWFGQjpsb2NhbGhvc3Q/some-sample-listing',
    );
  },

  'it normalizes listing names with spaces and punctuation': async (assert) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    let roomPrefix = matrixRoomIdToBranchName(roomId);
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
    let roomPrefix = matrixRoomIdToBranchName(roomId);
    assert.strictEqual(
      toBranchName(roomId, 'CamelCaseListing'),
      `${roomPrefix}/camel-case-listing`,
    );
  },

  'it drops the listing segment when the slug is empty': async (assert) => {
    let roomId = '!XezEDqUlIJcNdsuaFB:localhost';
    let roomPrefix = matrixRoomIdToBranchName(roomId);
    assert.strictEqual(toBranchName(roomId, '   '), roomPrefix);
  },

  'it rejects branch names without the prefix': async (assert) => {
    assert.throws(
      () => branchNameToMatrixRoomId('feature/room-abc'),
      /matrix room id prefix/,
    );
  },

  'it rejects branch names with an invalid encoded room id': async (assert) => {
    assert.throws(
      () => branchNameToMatrixRoomId('room-@@@'),
      /invalid encoded matrix room id/,
    );
  },
} as SharedTests<Record<string, never>>);

export default tests;
