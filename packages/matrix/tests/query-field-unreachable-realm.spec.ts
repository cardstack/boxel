import { expect, test } from './fixtures.ts';
import {
  createRealm,
  createSubscribedUserAndLogin,
  postCardSource,
  postNewCard,
} from '../helpers/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';

const serverIndexUrl = new URL(appURL).origin;

// Reserved by RFC 6761 — guaranteed never to resolve, so the realm server's
// cross-realm leg fails on it the way it fails on a peer that is down, without
// the test depending on a port being free or a service being stopped.
const UNREACHABLE_REALM_URL = 'https://example.invalid/offline/';

function uniqueRealmName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

test.describe('Query-backed relationship spanning an unreachable realm', () => {
  // The end-to-end shape of CS-12702's second half. A query-backed field whose
  // query targets two realms, one of which never answers: the realm that did
  // contributes its rows, and the realm that didn't withholds both its rows and
  // its share of the count. What the field must not do is let the rows in hand
  // read as the whole match set — a rollup over them would then publish a
  // confident number that is quietly short by however many instances the dead
  // realm holds, which is exactly the quantity its failure made unknowable.
  //
  // This lives here rather than in a host integration test because the failure
  // has to be a real one. The realm server fans the search out itself, over
  // real HTTP, from inside indexing — so staging it needs a real realm server
  // and a realm URL that genuinely does not answer, neither of which a mocked
  // fetch reproduces faithfully.
  test('reports the shortfall and refuses to publish a count for it', async ({
    page,
  }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'query-field-unreachable-realm',
      serverIndexUrl,
    );
    let realmName = uniqueRealmName('query-field-unreachable-realm');
    await createRealm(page, realmName);
    let realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    await postCardSource(
      page,
      realmURL,
      'person.gts',
      `
        import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
        export class Person extends CardDef {
          @field name = contains(StringField);
          @field team = contains(StringField);
          static fitted = class Fitted extends Component<typeof this> {
            <template><span data-test-person-name><@fields.name /></span></template>
          };
          static embedded = class Embedded extends Component<typeof this> {
            <template><span data-test-person-name><@fields.name /></span></template>
          };
        }
      `,
    );

    // The three computed fields are the read surface under test, and they are
    // deliberately computed rather than read from a component getter: a
    // `computeVia` rollup over a query-backed field is the thing CS-12702 says
    // goes quietly wrong, and computing them puts them through the same
    // indexing and prerender path a real rollup takes.
    await postCardSource(
      page,
      realmURL,
      'roster.gts',
      `
        import {
          CardDef,
          field,
          contains,
          linksToMany,
          StringField,
          Component,
          getRelationshipMembershipState,
        } from '@cardstack/base/card-api';
        import { Person } from './person';

        export class Roster extends CardDef {
          @field team = contains(StringField);
          @field members = linksToMany(Person, {
            query: {
              filter: { eq: { team: '$this.team' } },
              realms: ['${realmURL}', '${UNREACHABLE_REALM_URL}'],
            },
          });

          // Returned as-is: empty says the count is unknown, where a '?? 0'
          // would render a confident nought over a set nobody counted.
          @field matchCount = contains(StringField, {
            computeVia: function (this: Roster) {
              let { totalMatchCount } = getRelationshipMembershipState(
                this,
                'members',
              );
              return totalMatchCount == null ? 'unknown' : String(totalMatchCount);
            },
          });

          @field isPartial = contains(StringField, {
            computeVia: function (this: Roster) {
              return String(
                getRelationshipMembershipState(this, 'members').isPartial,
              );
            },
          });

          @field rowsInHand = contains(StringField, {
            computeVia: function (this: Roster) {
              let { membership } = getRelationshipMembershipState(
                this,
                'members',
              );
              return membership === undefined
                ? 'unresolved'
                : String(membership.length);
            },
          });

          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-roster>
                <span data-test-match-count><@fields.matchCount /></span>
                <span data-test-is-partial><@fields.isPartial /></span>
                <span data-test-rows-in-hand><@fields.rowsInHand /></span>
              </div>
            </template>
          };
        }
      `,
    );

    for (let name of ['Ada', 'Grace']) {
      await postNewCard(page, realmURL, {
        data: {
          attributes: { name, team: 'infra' },
          meta: {
            adoptsFrom: { module: `${realmURL}person`, name: 'Person' },
          },
        },
      });
    }

    let rosterId = await postNewCard(page, realmURL, {
      data: {
        attributes: { team: 'infra' },
        meta: {
          adoptsFrom: { module: `${realmURL}roster`, name: 'Roster' },
        },
      },
    });

    await page.goto(rosterId);
    await expect(
      page.locator(`[data-test-stack-card="${rosterId}"]`),
    ).toHaveCount(1);
    await expect(page.locator('[data-test-roster]')).toBeVisible();

    // The reachable realm's two matching people are in hand. They are also the
    // whole of what the field can show, which is the trap: nothing about the
    // rows themselves says a third realm was asked and did not answer.
    await expect(page.locator('[data-test-rows-in-hand]')).toHaveText('2', {
      timeout: 60_000,
    });

    // So the field says it, twice over. No count, because summing the realms
    // that answered would publish a floor as if it were the match count...
    await expect(page.locator('[data-test-match-count]')).toHaveText('unknown');
    // ...and the flag beside it, because a consumer that only ever reads the
    // count would otherwise see an absence and have no way to tell "nobody has
    // counted yet" from "the count is unknowable and the rows are short".
    await expect(page.locator('[data-test-is-partial]')).toHaveText('true');
  });
});
