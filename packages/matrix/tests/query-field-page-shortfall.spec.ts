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

test.describe('Query-backed relationship whose page cuts its result set short', () => {
  // CS-12702 end to end, on the leg that decides whether anyone notices: a
  // query-backed field holds a page of what its query matched, and a rollup
  // over those rows is short by the rest without anything in the rows saying
  // so. The field reports the true match count and flags the shortfall, so the
  // rollup can tell "these are all of them" from "these are the first few".
  //
  // A page smaller than the match count stands in for the server's page
  // ceiling, which is the same situation reached by a query large enough to hit
  // it — two rows against three matches exercises it without indexing the
  // several hundred instances the real ceiling would need.
  //
  // This belongs in a browser against a real realm server rather than in the
  // host integration suite, which already asserts the same three values
  // directly off `getRelationshipMembershipState`. What only this can show is
  // the join: the values survive indexing, prerender, and a live search in the
  // SPA, and arrive on a rendered card. The live leg matters most — a live
  // resource re-runs its search rather than trusting the seed, so a signal that
  // exists only in the indexed document would disappear on the first refresh.
  test('reports the true match count and flags the rows as partial', async ({
    page,
  }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'query-field-page-shortfall',
      serverIndexUrl,
    );
    let realmName = uniqueRealmName('query-field-page-shortfall');
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

    // `roster` holds two fields over the same three matches, differing only in
    // whether a page bounds them, so the pair separates "the field is short"
    // from "the signal is always on".
    //
    // The read surfaces are computed fields rather than component getters on
    // purpose: a `computeVia` reduction over a query-backed field is the shape
    // CS-12702 says goes quietly wrong, and computing them puts them through
    // the same indexing and prerender path a real rollup takes.
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

          // Sorted so which rows the page keeps is decided rather than
          // incidental; the counts below hold either way.
          @field firstFew = linksToMany(Person, {
            query: {
              filter: { eq: { team: '$this.team' } },
              sort: [{ by: 'name', direction: 'asc' }],
              page: { size: 2 },
            },
          });

          @field everyone = linksToMany(Person, {
            query: {
              filter: { eq: { team: '$this.team' } },
              sort: [{ by: 'name', direction: 'asc' }],
            },
          });

          // Returned as a string so an absent count is observable as such:
          // rendering '0' or an empty slot for "nobody counted" is the confident
          // number this whole signal exists to avoid.
          @field pagedCount = contains(StringField, {
            computeVia: function (this: Roster) {
              let { totalMatchCount } = getRelationshipMembershipState(
                this,
                'firstFew',
              );
              return totalMatchCount == null
                ? 'unknown'
                : String(totalMatchCount);
            },
          });

          @field pagedRows = contains(StringField, {
            computeVia: function (this: Roster) {
              let { membership } = getRelationshipMembershipState(
                this,
                'firstFew',
              );
              return membership === undefined
                ? 'unresolved'
                : String(membership.length);
            },
          });

          @field pagedIsPartial = contains(StringField, {
            computeVia: function (this: Roster) {
              return String(
                getRelationshipMembershipState(this, 'firstFew').isPartial,
              );
            },
          });

          @field wholeRows = contains(StringField, {
            computeVia: function (this: Roster) {
              let { membership } = getRelationshipMembershipState(
                this,
                'everyone',
              );
              return membership === undefined
                ? 'unresolved'
                : String(membership.length);
            },
          });

          @field wholeIsPartial = contains(StringField, {
            computeVia: function (this: Roster) {
              return String(
                getRelationshipMembershipState(this, 'everyone').isPartial,
              );
            },
          });

          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-roster>
                <span data-test-paged-count><@fields.pagedCount /></span>
                <span data-test-paged-rows><@fields.pagedRows /></span>
                <span data-test-paged-is-partial><@fields.pagedIsPartial /></span>
                <span data-test-whole-rows><@fields.wholeRows /></span>
                <span data-test-whole-is-partial><@fields.wholeIsPartial /></span>
              </div>
            </template>
          };
        }
      `,
    );

    for (let name of ['Ada', 'Grace', 'Katherine']) {
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

    // The page allowed two of the three matches. That is also the whole of
    // what the field can show, which is the trap: nothing about the rows says
    // a third one exists.
    await expect(page.locator('[data-test-paged-rows]')).toHaveText('2', {
      timeout: 60_000,
    });

    // So the field says it, twice over. The count is what the query matched
    // rather than what the page returned, because a rollup that wants a total
    // can read it and skip the rows entirely...
    await expect(page.locator('[data-test-paged-count]')).toHaveText('3');
    // ...and the flag beside it, because a rollup that must reduce over the
    // rows needs to know its answer is short before it publishes one.
    await expect(page.locator('[data-test-paged-is-partial]')).toHaveText(
      'true',
    );

    // The same query with no page holds every match, so the shortfall is
    // reported where there is one and not where there isn't — an always-true
    // flag would be as useless as an always-false one.
    await expect(page.locator('[data-test-whole-rows]')).toHaveText('3');
    await expect(page.locator('[data-test-whole-is-partial]')).toHaveText(
      'false',
    );
  });
});
