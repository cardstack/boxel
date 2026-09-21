import { expect, test } from './fixtures.ts';
import {
  createRealm,
  createSubscribedUserAndLogin,
  postCardSource,
  postNewCard,
} from '../helpers/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';

const serverIndexUrl = new URL(appURL).origin;

function uniqueRealmName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// A card that autosaves faster than the realm indexes it, which is one person
// typing rather than an adversary. Each save carries a revision one higher
// than the last, so what came back is comparable to what went out.
const SAVES = 8;

// The contract under test: a save is answered out of the index, so it must be
// settled by a pass that ran after its own bytes landed. It may be answered
// with something NEWER — a later save's pass covers an earlier save's bytes
// too, and that is the coalescing this design wants — but never with
// something older. Monotonic, never regressing.
//
// Nothing below this suite can see it. The host's tests run against SQLite and
// have no `jobs` table at all, so the queue's coalescing decision does not
// exist there. The realm-server's own tests reach the coalescing but drive the
// index updater directly, so a test there either runs a real worker it cannot
// control or stubs the updater and stops exercising the thing that decides.
// Here the realm server, its worker, its postgres queue and a real browser
// session are all present, and the decision is made where it is made in
// production: inside the publish transaction, against rows another save wrote.
const cardSource = `
  import { CardDef, field, contains } from '@cardstack/base/card-api';
  import NumberField from '@cardstack/base/number';
  import StringField from '@cardstack/base/string';

  export class DraftNote extends CardDef {
    static displayName = 'Draft Note';
    @field revision = contains(NumberField);
    @field body = contains(StringField);
  }
`;

// Read a card the way every non-rendering consumer does: out of the index.
async function indexedRevision(
  page: import('@playwright/test').Page,
  realmURL: string,
  cardId: string,
): Promise<unknown> {
  return await page.evaluate(
    async ({ realmURL, cardId }) => {
      let token = JSON.parse(localStorage['boxel-session'])[realmURL];
      let response = await fetch(cardId, {
        headers: {
          accept: 'application/vnd.card+json',
          authorization: token,
        },
        mode: 'cors',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(
          `GET ${cardId} failed with HTTP ${response.status}: ${await response.text()}`,
        );
      }
      let doc = await response.json();
      return doc?.data?.attributes?.revision;
    },
    { realmURL, cardId },
  );
}

test.describe('Concurrent saves to one card — read-your-writes', () => {
  test('every save is answered with its own revision or a newer one, never an older one', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    let { username } = await createSubscribedUserAndLogin(
      page,
      'concurrent-save',
      serverIndexUrl,
    );
    let realmName = uniqueRealmName('concurrent-save');
    await createRealm(page, realmName);
    let realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    await postCardSource(page, realmURL, 'draft-note.gts', cardSource);
    let cardId = await postNewCard(page, realmURL, {
      data: {
        attributes: { revision: 0, body: 'first' },
        meta: {
          adoptsFrom: {
            module: `${realmURL}draft-note`,
            name: 'DraftNote',
          },
        },
      },
    });

    await expect
      .poll(async () => await indexedRevision(page, realmURL, cardId), {
        timeout: 180_000,
        message: 'the card is indexed before the burst starts',
      })
      .toBe(0);

    // Fired together rather than one after another, which is what makes them
    // contend: each takes the card's write locks, and each is answered from
    // the index once its own pass has landed. Serialized, this proves less —
    // the observed revisions are reported below either way, so a run that did
    // not overlap is visible rather than silently green.
    let answered = await page.evaluate(
      async ({ realmURL, cardId, saves }) => {
        let token = JSON.parse(localStorage['boxel-session'])[realmURL];
        let save = async (revision: number) => {
          let response = await fetch(cardId, {
            method: 'PATCH',
            headers: {
              accept: 'application/vnd.card+json',
              'content-type': 'application/vnd.card+json',
              authorization: token,
            },
            mode: 'cors',
            credentials: 'include',
            body: JSON.stringify({
              data: {
                type: 'card',
                attributes: { revision, body: `revision ${revision}` },
                meta: {
                  adoptsFrom: {
                    module: `${realmURL}draft-note`,
                    name: 'DraftNote',
                  },
                },
              },
            }),
          });
          let body = await response.text();
          if (!response.ok) {
            throw new Error(
              `PATCH revision ${revision} failed with HTTP ${response.status}: ${body}`,
            );
          }
          return {
            sent: revision,
            answered: JSON.parse(body)?.data?.attributes?.revision,
          };
        };
        return await Promise.all(
          [...new Array(saves)].map((_, index) => save(index + 1)),
        );
      },
      { realmURL, cardId, saves: SAVES },
    );

    let regressed = answered.filter(
      (r) => typeof r.answered !== 'number' || r.answered < r.sent,
    );
    expect(
      regressed,
      `every save reads at least its own write — answered ${JSON.stringify(answered)}`,
    ).toEqual([]);

    // How much of the burst actually overlapped, reported rather than
    // asserted: a save answered ahead of its own revision was settled by a
    // pass carrying a later save's bytes, which only happens when the two were
    // in flight together. Asserting a floor here would be asserting that this
    // machine was busy enough, which is a different claim and a flaky one.
    let coalesced = answered.filter(
      (r) => (r.answered as number) > r.sent,
    ).length;
    test.info().annotations.push({
      type: 'overlap',
      description: `${coalesced} of ${SAVES} saves were answered by a pass carrying a later save's bytes`,
    });

    // The realm ends holding the last write, not whichever pass landed last.
    await expect
      .poll(async () => await indexedRevision(page, realmURL, cardId), {
        timeout: 180_000,
        message: 'the last save is what the realm is left holding',
      })
      .toBe(SAVES);
  });
});
