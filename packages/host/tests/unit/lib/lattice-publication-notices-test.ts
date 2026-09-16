import { module, test } from 'qunit';

import LatticePublicationNotices, {
  LATTICE_NOTICE_IDENTITY_LIMIT,
} from '@cardstack/host/lib/lattice-publication-notices';

const realm = 'https://example.com/cards/';
const url = `${realm}Day/blue`;
const ready = {
  state: 'ready' as const,
  validatedThrough: 2,
  outputRevision: 2,
};
const event = {
  eventName: 'index',
  indexType: 'incremental',
  realmURL: realm,
  invalidations: [url],
  generation: 3,
  publicationId: 'published-3',
};
const create = () =>
  new LatticePublicationNotices((id) => id.replace(/\.json$/, ''));

module('Unit | Lattice publication notices', function () {
  test('ordinary, HTML and malformed notices do not enter the index', function (assert) {
    let notices = create();
    for (let bad of [
      { ...event, publicationId: undefined },
      { ...event, eventName: 'prerender_html' },
      { ...event, generation: NaN },
      { ...event, generation: -1 },
      { ...event, generation: '3' },
      {
        ...event,
        invalidations: [`${realm}Other`, 'https://elsewhere.example/card'],
      },
      { ...event, invalidations: [`${url}?stale=true`] },
      { ...event, invalidations: [null] },
      { ...event, realmURL: 'not-a-realm' },
    ])
      notices.record(bad);
    assert.strictEqual(notices.size, 0);
    assert.false(notices.needsRead(realm, url, ready));
    notices.record(event);
    assert.strictEqual(notices.size, 1);
    assert.true(notices.needsRead(realm, url, ready));
  });

  test('versions are monotonic and scoped to identity and exact realm', function (assert) {
    let notices = create();
    notices.record(event);
    notices.record({ ...event, invalidations: [`${url}.json`], generation: 1 });
    notices.record(event);
    assert.strictEqual(
      notices.size,
      1,
      'aliases and duplicate notices share one head',
    );
    assert.true(notices.needsRead(realm, url, ready));
    assert.false(notices.needsRead(realm, `${realm}Day/other`, ready));
    assert.false(notices.needsRead(`${realm}nested/`, url, ready));
    assert.false(
      notices.needsRead(realm, url, { ...ready, validatedThrough: 3 }),
      'validated equal output already covers the notice',
    );
    assert.false(
      notices.needsRead(realm, url, { ...ready, outputRevision: 3 }),
    );
    assert.true(
      notices.needsRead(realm, url, {
        ...ready,
        state: 'pending',
        validatedThrough: 3,
      }),
      'pending at the same generation still needs ready confirmation',
    );
  });

  test('overflow stays bounded and retains a conservative confirmation obligation', function (assert) {
    let notices = create();
    notices.record(event);
    for (let i = 0; i < LATTICE_NOTICE_IDENTITY_LIMIT; i++) {
      notices.record({
        ...event,
        invalidations: [`${realm}Other/${i}`],
        generation: 10 + i,
      });
    }
    assert.strictEqual(notices.size, LATTICE_NOTICE_IDENTITY_LIMIT);
    assert.true(
      notices.needsRead(realm, url, ready),
      'evicting its exact head does not forget the notice',
    );
    assert.true(
      notices.needsRead(realm, `${realm}Unknown`, ready),
      'older unknown coverage is repaired conservatively',
    );
    assert.false(
      notices.needsRead(realm, `${realm}Unknown`, {
        ...ready,
        validatedThrough: 4,
      }),
      'a body newer than the discarded head is sufficient',
    );
    assert.false(
      notices.needsRead('https://other.example/cards/', url, ready),
      'overflow never compares generations across realms',
    );
  });

  test('unsubscription and reset discard the corresponding evidence', function (assert) {
    let notices = create();
    let other = 'https://other.example/cards/';
    notices.record(event);
    notices.record({
      ...event,
      realmURL: other,
      invalidations: [`${other}day`],
    });
    notices.forget(realm);
    assert.strictEqual(notices.size, 1);
    assert.false(notices.needsRead(realm, url, ready));
    assert.true(notices.needsRead(other, `${other}day`, ready));
    notices.clear();
    assert.strictEqual(notices.size, 0);
    assert.false(notices.needsRead(other, `${other}day`, ready));
  });
});
