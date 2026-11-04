import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { readFileSync } from 'fs';
import {
  GoogleAccountRefusal,
  resolveGoogleAccount,
} from '../lib/google-account.ts';

const VECTORS_PATH = join(import.meta.dirname, 'google-sign-in-vectors.json');

interface Vector {
  name: string;
  userinfo: {
    sub: string;
    email?: string;
    email_verified?: unknown;
    name?: string;
  };
  usersByEmail: string[];
  existingLocalparts: string[];
  expected:
    | { outcome: 'refused'; message: string }
    | {
        outcome: 'existing' | 'new';
        localpart: string;
        displayName: string | null;
        email: string;
      };
}

function localpartOf(userId: string) {
  return userId.slice(1).split(':')[0];
}

module(basename(import.meta.filename), function () {
  module('Google account resolution', function () {
    test('resolves every shared vector as the mapping provider does', async function (assert) {
      let { vectors } = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as {
        vectors: Vector[];
      };
      assert.ok(vectors.length > 0, 'there are vectors');
      for (let vector of vectors) {
        let { userinfo, expected } = vector;
        // Compared without case, as Synapse compares localparts.
        let taken = new Set(
          vector.existingLocalparts.map((localpart) => localpart.toLowerCase()),
        );
        let outcome: unknown;
        try {
          let resolved = await resolveGoogleAccount(
            {
              sub: userinfo.sub,
              email: userinfo.email,
              emailVerified: userinfo.email_verified as boolean | undefined,
              name: userinfo.name,
            },
            {
              usersByEmail: async () => vector.usersByEmail,
              localpartTaken: async (localpart) =>
                taken.has(localpart.toLowerCase()),
            },
          );
          outcome = {
            outcome: resolved.kind,
            localpart:
              resolved.kind === 'existing'
                ? localpartOf(resolved.user)
                : resolved.localpart,
            displayName: resolved.displayName ?? null,
            email: resolved.email,
          };
        } catch (e) {
          if (!(e instanceof GoogleAccountRefusal)) {
            throw e;
          }
          outcome = { outcome: 'refused', message: e.message };
        }
        assert.deepEqual(outcome, expected, vector.name);
      }
    });
  });
});
