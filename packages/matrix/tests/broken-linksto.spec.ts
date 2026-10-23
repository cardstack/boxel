import type { Page } from '@playwright/test';
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

// Logs what the realm serves for the linking card and its deleted target, so
// a failed cold visit shows whether the realm was still serving the deleted
// card in the linking card's `included`, and whether that body came from the
// realm's card document cache. Read outside the page so the response headers
// the browser cannot see cross-origin are readable.
async function logServedLinkState(
  page: Page,
  label: string,
  {
    realmURL,
    linkingId,
    deletedId,
  }: { realmURL: string; linkingId: string; deletedId: string },
) {
  let token = await page.evaluate(
    (realmURL) => JSON.parse(localStorage['boxel-session'] ?? '{}')[realmURL],
    realmURL,
  );
  let headers = {
    accept: 'application/vnd.card+json',
    ...(token ? { authorization: token } : {}),
  };
  let linking = await page.request.get(linkingId, { headers });
  let deleted = await page.request.get(deletedId, { headers });
  let body = linking.ok() ? await linking.json() : undefined;
  // The deleted card reaches the linking card's index visit only through a
  // dep that names it, so log the stored deps that could.
  let deps = await page.request.get(
    `${realmURL}_card-dependencies?url=${encodeURIComponent(linkingId)}`,
    { headers: { ...headers, accept: 'application/json' } },
  );
  let depsBody: unknown = deps.ok() ? await deps.json() : undefined;
  let deletedSegment = new URL(deletedId).pathname.split('/').pop()!;
  console.log(
    `[broken-linksto] ${label}: ${JSON.stringify({
      at: new Date().toISOString(),
      linkingStatus: linking.status(),
      linkingEtag: linking.headers()['etag'],
      linkingCardCache: linking.headers()['x-boxel-card-cache'],
      linkingGeneration: body?.data?.meta?.generation,
      includedIds: (body?.included ?? []).map((r: { id: string }) => r.id),
      deletedStatus: deleted.status(),
      linkingDepsStatus: deps.status(),
      linkingDepsNamingDeleted: Array.isArray(depsBody)
        ? depsBody.filter(
            (dep): dep is string =>
              typeof dep === 'string' && dep.includes(deletedSegment),
          )
        : depsBody,
    })}`,
  );
}

test.describe('Broken linksTo tolerance', () => {
  test('a card whose linksTo target is deleted while the page is open still renders cleanly on a fresh visit, with the broken slot showing the placeholder', async ({
    page,
  }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'broken-link-tolerance',
      serverIndexUrl,
    );
    let realmName = uniqueRealmName('broken-link-tolerance');
    await createRealm(page, realmName);
    let realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    // Pet card definition. The embedded template surfaces the pet name so
    // the present-link path is observable below.
    await postCardSource(
      page,
      realmURL,
      'pet.gts',
      `
        import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
        export class Pet extends CardDef {
          @field firstName = contains(StringField);
          static embedded = class Embedded extends Component<typeof this> {
            <template><span data-test-pet-name><@fields.firstName /></span></template>
          };
          static fitted = class Fitted extends Component<typeof this> {
            <template><span data-test-pet-name><@fields.firstName /></span></template>
          };
        }
      `,
    );

    // PetPerson definition with a linksTo Pet. The isolated render exposes
    // the person name (always present) and the pet field (the slot under
    // test).
    await postCardSource(
      page,
      realmURL,
      'pet-person.gts',
      `
        import { CardDef, field, contains, linksTo, StringField, Component } from '@cardstack/base/card-api';
        import { Pet } from './pet';
        export class PetPerson extends CardDef {
          @field firstName = contains(StringField);
          @field pet = linksTo(Pet);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1 data-test-person-name><@fields.firstName /></h1>
              <div data-test-pet-slot><@fields.pet /></div>
            </template>
          };
        }
      `,
    );

    let ringoId = await postNewCard(page, realmURL, {
      data: {
        attributes: { firstName: 'Ringo' },
        meta: {
          adoptsFrom: { module: `${realmURL}pet`, name: 'Pet' },
        },
      },
    });

    let hassanId = await postNewCard(page, realmURL, {
      data: {
        attributes: { firstName: 'Hassan' },
        relationships: {
          pet: { links: { self: ringoId } },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}pet-person`,
            name: 'PetPerson',
          },
        },
      },
    });

    // Baseline: a present link renders the linked card normally; no
    // placeholder is dispatched.
    await page.goto(hassanId);
    await expect(
      page.locator(`[data-test-stack-card="${hassanId}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test-pet-slot] [data-test-pet-name]'),
    ).toHaveText('Ringo');
    await expect(page.locator('[data-test-broken-link-template]')).toHaveCount(
      0,
    );

    // Break the link while the page is open: delete the linked Pet
    // instance via the realm-server card endpoint. The realm broadcasts
    // an SSE update for the removed file; the host's reactive store
    // invalidates the pet field's bucket entry, the lazy load runs again
    // and 404s, plants a link-not-found sentinel, and the placeholder
    // takes over the slot without a navigation.
    await page.evaluate(
      async ({ realmURL, ringoId }) => {
        let token = JSON.parse(localStorage['boxel-session'])[realmURL];
        let response = await fetch(ringoId, {
          method: 'DELETE',
          headers: {
            accept: 'application/vnd.card+json',
            authorization: token,
          },
          mode: 'cors',
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(
            `delete ${ringoId} failed with HTTP ${response.status}: ${await response.text()}`,
          );
        }
      },
      { realmURL, ringoId },
    );

    await expect(
      page.locator('[data-test-pet-slot] [data-test-broken-link-template]'),
    ).toHaveCount(1, { timeout: 60_000 });
    await expect(
      page.locator('[data-test-pet-slot] [data-test-broken-link-state]'),
    ).toHaveAttribute('data-test-broken-link-state', 'not-found');
    await expect(
      page.locator('[data-test-pet-slot] [data-test-broken-link-url]').first(),
    ).toContainText(ringoId);
    // The rest of PetPerson is unaffected — only the broken slot becomes
    // the placeholder.
    await expect(page.locator('[data-test-person-name]')).toHaveText('Hassan');
    await logServedLinkState(page, 'before cold visit', {
      realmURL,
      linkingId: hassanId,
      deletedId: ringoId,
    });

    // Reload to drop all in-memory state, then verify the cold visit. The
    // realm-server must serve PetPerson as a normal 200 instance (broken
    // linksTo targets do not classify the consuming card as an indexing
    // error), and the broken slot renders the placeholder while the rest
    // of the card renders intact.
    await page.reload();
    await expect(
      page.locator(`[data-test-stack-card="${hassanId}"]`),
    ).toHaveCount(1);
    await expect(page.locator('[data-test-person-name]')).toHaveText('Hassan');
    await logServedLinkState(page, 'cold visit', {
      realmURL,
      linkingId: hassanId,
      deletedId: ringoId,
    });
    await expect(
      page.locator('[data-test-pet-slot] [data-test-broken-link-template]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test-pet-slot] [data-test-broken-link-state]'),
    ).toHaveAttribute('data-test-broken-link-state', 'not-found');
    await expect(
      page.locator('[data-test-pet-slot] [data-test-broken-link-url]').first(),
    ).toContainText(ringoId);
  });

  test('a linksToMany element deleted while the page is open shows the placeholder live in the deleted slot only; sibling slots keep rendering, and a fresh visit reproduces the same per-slot state', async ({
    page,
  }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'broken-link-tolerance-many',
      serverIndexUrl,
    );
    let realmName = uniqueRealmName('broken-link-tolerance-many');
    await createRealm(page, realmName);
    let realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    // Same Pet card definition as the singular test, plus a PetPerson with
    // a `linksToMany` Pet array. The isolated template wraps each rendered
    // pet in a per-index container so a sibling render is observable while
    // the broken slot shows the placeholder.
    await postCardSource(
      page,
      realmURL,
      'pet.gts',
      `
        import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
        export class Pet extends CardDef {
          @field firstName = contains(StringField);
          static embedded = class Embedded extends Component<typeof this> {
            <template><span data-test-pet-name><@fields.firstName /></span></template>
          };
          static fitted = class Fitted extends Component<typeof this> {
            <template><span data-test-pet-name><@fields.firstName /></span></template>
          };
        }
      `,
    );

    await postCardSource(
      page,
      realmURL,
      'pet-person.gts',
      `
        import { CardDef, field, contains, linksToMany, StringField, Component } from '@cardstack/base/card-api';
        import { Pet } from './pet';
        export class PetPerson extends CardDef {
          @field firstName = contains(StringField);
          @field pets = linksToMany(Pet);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1 data-test-person-name><@fields.firstName /></h1>
              <div data-test-pets-slot>
                <@fields.pets />
              </div>
            </template>
          };
        }
      `,
    );

    let ringoId = await postNewCard(page, realmURL, {
      data: {
        attributes: { firstName: 'Ringo' },
        meta: {
          adoptsFrom: { module: `${realmURL}pet`, name: 'Pet' },
        },
      },
    });
    let mangoId = await postNewCard(page, realmURL, {
      data: {
        attributes: { firstName: 'Mango' },
        meta: {
          adoptsFrom: { module: `${realmURL}pet`, name: 'Pet' },
        },
      },
    });

    let hassanId = await postNewCard(page, realmURL, {
      data: {
        attributes: { firstName: 'Hassan' },
        relationships: {
          'pets.0': { links: { self: ringoId } },
          'pets.1': { links: { self: mangoId } },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}pet-person`,
            name: 'PetPerson',
          },
        },
      },
    });

    // Baseline: both elements render as embedded pet cards. No placeholder
    // is dispatched anywhere in the plural slot.
    await page.goto(hassanId);
    await expect(
      page.locator(`[data-test-stack-card="${hassanId}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test-pets-slot] [data-test-pet-name]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-test-pets-slot] [data-test-pet-name]').nth(0),
    ).toHaveText('Ringo');
    await expect(
      page.locator('[data-test-pets-slot] [data-test-pet-name]').nth(1),
    ).toHaveText('Mango');
    await expect(
      page.locator('[data-test-pets-slot] [data-test-broken-link-template]'),
    ).toHaveCount(0);

    // Delete one element (Ringo, the first slot). The realm broadcasts
    // the removed file; the host rewrites that slot's bucket entry to a
    // link-not-found sentinel via `notifyLinksToTargetDeleted` and the
    // per-element placeholder takes over without disturbing the Mango
    // slot.
    await page.evaluate(
      async ({ realmURL, ringoId }) => {
        let token = JSON.parse(localStorage['boxel-session'])[realmURL];
        let response = await fetch(ringoId, {
          method: 'DELETE',
          headers: {
            accept: 'application/vnd.card+json',
            authorization: token,
          },
          mode: 'cors',
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(
            `delete ${ringoId} failed with HTTP ${response.status}: ${await response.text()}`,
          );
        }
      },
      { realmURL, ringoId },
    );

    await expect(
      page.locator('[data-test-pets-slot] [data-test-broken-link-template]'),
    ).toHaveCount(1, { timeout: 60_000 });
    await expect(
      page.locator('[data-test-pets-slot] [data-test-broken-link-state]'),
    ).toHaveAttribute('data-test-broken-link-state', 'not-found');
    await expect(
      page.locator('[data-test-pets-slot] [data-test-broken-link-url]').first(),
    ).toContainText(ringoId);
    // Sibling slot continues to render Mango as a normal embedded pet.
    await expect(
      page.locator('[data-test-pets-slot] [data-test-pet-name]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test-pets-slot] [data-test-pet-name]'),
    ).toHaveText('Mango');
    await expect(page.locator('[data-test-person-name]')).toHaveText('Hassan');
    await logServedLinkState(page, 'before cold visit', {
      realmURL,
      linkingId: hassanId,
      deletedId: ringoId,
    });

    // Cold visit: reload and confirm the per-slot state survives. PetPerson
    // serves as a normal 200 instance and the per-element placeholder
    // renders in the deleted slot while the live sibling stays.
    await page.reload();
    await expect(
      page.locator(`[data-test-stack-card="${hassanId}"]`),
    ).toHaveCount(1);
    await expect(page.locator('[data-test-person-name]')).toHaveText('Hassan');
    await logServedLinkState(page, 'cold visit', {
      realmURL,
      linkingId: hassanId,
      deletedId: ringoId,
    });
    await expect(
      page.locator('[data-test-pets-slot] [data-test-broken-link-template]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test-pets-slot] [data-test-broken-link-state]'),
    ).toHaveAttribute('data-test-broken-link-state', 'not-found');
    await expect(
      page.locator('[data-test-pets-slot] [data-test-broken-link-url]').first(),
    ).toContainText(ringoId);
    await expect(
      page.locator('[data-test-pets-slot] [data-test-pet-name]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test-pets-slot] [data-test-pet-name]'),
    ).toHaveText('Mango');
  });
});
