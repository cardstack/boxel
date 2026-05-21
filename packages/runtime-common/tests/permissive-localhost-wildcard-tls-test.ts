import type { PeerCertificate } from 'node:tls';

import { permissiveLocalhostWildcardCheckServerIdentity } from '../permissive-localhost-wildcard-tls';
import type { SharedTests } from '../helpers';

function makeCert(opts: {
  subjectaltname?: string;
  subjectCN?: string;
}): PeerCertificate {
  return {
    subject: { CN: opts.subjectCN ?? 'localhost' },
    subjectaltname: opts.subjectaltname,
  } as unknown as PeerCertificate;
}

const wildcardLocalhostCert = makeCert({
  subjectaltname:
    'DNS:localhost, DNS:*.localhost, DNS:published.realm, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1',
});

const certWithoutWildcard = makeCert({
  subjectaltname:
    'DNS:localhost, DNS:published.realm, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1',
});

const tests = Object.freeze({
  'accepts user.localhost when cert has DNS:*.localhost SAN': async (
    assert,
  ) => {
    let result = permissiveLocalhostWildcardCheckServerIdentity(
      'user.localhost',
      wildcardLocalhostCert,
    );
    assert.strictEqual(result, undefined);
  },

  'accepts user.localhost. (FQDN trailing-dot form) when cert has DNS:*.localhost SAN':
    async (assert) => {
      let result = permissiveLocalhostWildcardCheckServerIdentity(
        'user.localhost.',
        wildcardLocalhostCert,
      );
      assert.strictEqual(result, undefined);
    },

  'rejects user.localhost when cert lacks DNS:*.localhost SAN': async (
    assert,
  ) => {
    let result = permissiveLocalhostWildcardCheckServerIdentity(
      'user.localhost',
      certWithoutWildcard,
    );
    assert.ok(
      result instanceof Error,
      'expected the original Node TLS error to be returned',
    );
  },

  'rejects multi-label foo.bar.localhost even when cert has DNS:*.localhost SAN':
    async (assert) => {
      let result = permissiveLocalhostWildcardCheckServerIdentity(
        'foo.bar.localhost',
        wildcardLocalhostCert,
      );
      assert.ok(
        result instanceof Error,
        'two-label-deep subdomain should not be silently accepted by the *.localhost wildcard override',
      );
    },

  'leaves the exact-match localhost case alone (defers to default check)':
    async (assert) => {
      let result = permissiveLocalhostWildcardCheckServerIdentity(
        'localhost',
        wildcardLocalhostCert,
      );
      assert.strictEqual(result, undefined);
    },

  'does not relax checks for non-localhost hosts even when SAN is permissive':
    async (assert) => {
      let result = permissiveLocalhostWildcardCheckServerIdentity(
        'evil.example.com',
        wildcardLocalhostCert,
      );
      assert.ok(
        result instanceof Error,
        'override must be scoped to *.localhost host pattern',
      );
    },
} as SharedTests<{}>);

export default tests;
