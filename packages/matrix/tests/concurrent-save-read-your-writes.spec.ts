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
// typing rather than an adversary. Each save sets a field of its own — save k
// writes `k` into `mark<k>` and touches nothing else — so a response says
// exactly which saves' bytes the pass that answered it had seen.
const SAVES = 8;
const markFields = [...new Array(SAVES)].map((_, index) => `mark${index + 1}`);

// The contract under test: a save is answered out of the index, so it must be
// settled by a pass that ran after its own bytes landed. It may be answered
// with something NEWER — a later save's pass covers an earlier save's bytes
// too, and that is the coalescing this design wants — but never with
// something older, which is a document missing the save's own mark.
//
// Saves fired together reach the write lock in whatever order the server
// happens to take them, not the order they were sent in, so nothing here reads
// meaning into the order. A patch merges over the stored bytes inside the
// write lock, so every save lands whichever order they take, and whether an
// answer holds its own mark is a question with one answer in any order.
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
    @field body = contains(StringField);
${markFields.map((name) => `    @field ${name} = contains(NumberField);`).join('\n')}
  }
`;

// Read a card the way every non-rendering consumer does: out of the index.
async function indexedAttributes(
  page: import('@playwright/test').Page,
  realmURL: string,
  cardId: string,
): Promise<Record<string, unknown>> {
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
      return doc?.data?.attributes ?? {};
    },
    { realmURL, cardId },
  );
}

test.describe('Concurrent saves to one card — read-your-writes', () => {
  test('every save is answered with its own write or a newer one, never an older one', async ({
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
        attributes: { body: 'first' },
        meta: {
          adoptsFrom: {
            module: `${realmURL}draft-note`,
            name: 'DraftNote',
          },
        },
      },
    });

    await expect
      .poll(
        async () => (await indexedAttributes(page, realmURL, cardId)).body,
        {
          timeout: 180_000,
          message: 'the card is indexed before the burst starts',
        },
      )
      .toBe('first');

    // Fired together rather than one after another, which is what makes them
    // contend: each takes the card's write locks, and each is answered from
    // the index once its own pass has landed. Serialized, this proves less —
    // the overlap is reported below either way, so a run that did not overlap
    // is visible rather than silently green.
    let answered = await page.evaluate(
      async ({ realmURL, cardId, markFields }) => {
        let token = JSON.parse(localStorage['boxel-session'])[realmURL];
        let startedAt = performance.now();
        let save = async (sent: number) => {
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
                attributes: { [`mark${sent}`]: sent },
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
              `PATCH mark${sent} failed with HTTP ${response.status}: ${body}`,
            );
          }
          let doc = JSON.parse(body);
          let attributes = doc?.data?.attributes ?? {};
          return {
            sent,
            // The saves whose marks the answering pass had seen.
            seen: markFields
              .map((_, index) => index + 1)
              .filter((k) => attributes[`mark${k}`] === k),
            // Carried only for a failure's message: the version of the bytes
            // this save committed, and how long into the burst it was
            // answered.
            version: doc?.data?.meta?.version,
            lastModified: doc?.data?.meta?.lastModified,
            answeredAfterMs: Math.round(performance.now() - startedAt),
          };
        };
        return await Promise.all(markFields.map((_, index) => save(index + 1)));
      },
      { realmURL, cardId, markFields },
    );

    let regressed = answered.filter((r) => !r.seen.includes(r.sent));
    expect(
      regressed,
      `every save reads at least its own write — answered ${JSON.stringify(answered)}`,
    ).toEqual([]);

    // How much of the burst actually overlapped, reported rather than
    // asserted. A save whose answer holds another save's mark, while that
    // save's answer holds its mark in turn, was answered after the other
    // committed and vice versa, so neither was settled before the other
    // reached the realm: the two were in flight together. Saves settled one
    // at a time never pair up this way, since the earlier answer cannot hold
    // the later mark. This says nothing about how many index passes answered
    // them. It reads marks only, so it holds wherever it runs relative to the
    // assertion above. Asserting a floor here would be asserting that this
    // machine was busy enough, which is a different claim and a flaky one.
    let coalesced = answered.filter((r) =>
      answered.some(
        (o) => o !== r && r.seen.includes(o.sent) && o.seen.includes(r.sent),
      ),
    ).length;
    test.info().annotations.push({
      type: 'overlap',
      description: `${coalesced} of ${SAVES} saves were answered with another save's mark while that save was answered with theirs — answered ${JSON.stringify(answered)}`,
    });

    // The realm ends holding every save, not whichever pass landed last.
    let everyMark = Object.fromEntries(
      markFields.map((name, index) => [name, index + 1]),
    );
    await expect
      .poll(
        async () => {
          let attributes = await indexedAttributes(page, realmURL, cardId);
          return Object.fromEntries(
            markFields.map((name) => [name, attributes[name]]),
          );
        },
        {
          timeout: 180_000,
          message: 'every save is in what the realm is left holding',
        },
      )
      .toEqual(everyMark);
  });
});
