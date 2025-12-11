import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  createSubscribedUserAndLogin,
  openRoot,
  postCardSource,
} from '../helpers';

test.describe('Head tags', () => {
  let user: { username: string; password: string; credentials: any };

  async function createUserAndRealm(
    page: Page,
    {
      prefix = 'publish-realm',
      realmName = 'new-workspace',
      displayName = '1New Workspace',
    } = {},
  ) {
    let serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);

    user = await createSubscribedUserAndLogin(page, prefix, serverIndexUrl);

    await createRealm(page, realmName, displayName);

    let realmURL = new URL(`${user.username}/${realmName}/`, serverIndexUrl)
      .href;

    return { serverIndexUrl, realmURL, realmName, displayName };
  }

  async function openPublishRealmModal(
    page: Page,
    workspaceDisplayName: string,
  ) {
    await openRoot(page, appURL);
    await page.locator('[data-test-workspace-chooser-toggle]').click();
    await expect(page.locator('[data-test-workspace-chooser]')).toBeVisible();
    await page
      .locator(`[data-test-workspace="${workspaceDisplayName}"]`)
      .click();
    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();

    await page.locator('[data-test-publish-realm-button]').click();
  }

  async function publishDefaultRealm(
    page: Page,
    opts?: { realmName?: string; displayName?: string },
  ) {
    let { realmName = 'new-workspace', displayName = '1New Workspace' } =
      opts ?? {};
    await createUserAndRealm(page, {
      prefix: 'publish-realm',
      realmName,
      displayName,
    });
    await openPublishRealmModal(page, displayName);
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();

    await page.waitForSelector('[data-test-unpublish-button]');
    await expect(
      page.locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      ),
    ).toBeVisible();
  }

  test('the HTML response from a published realm has relevant meta tags', async ({
    page,
  }) => {
    await publishDefaultRealm(page);

    let publishedRealmURLString = `http://${user.username}.localhost:4205/new-workspace/index`;

    await page.goto(publishedRealmURLString);

    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      '1New Workspace',
    );

    // TODO: restore in CS-9805
    // await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    //   'content',
    //   publishedRealmURLString,
    // );
  });

  test('host mode updates head tags when navigating between cards', async ({
    page,
  }) => {
    let realmName = `head-tags-${randomUUID()}`;
    let { realmURL, displayName } = await createUserAndRealm(page, {
      prefix: 'host-head-tags',
      realmName,
      displayName: realmName,
    });

    await page.goto(realmURL);
    await page.locator('[data-test-stack-item-content]').first().waitFor();

    let defaultHeadCardSource = `
      import { action } from '@ember/object';
      import { consume } from 'ember-provide-consume-context';
      import { on } from '@ember/modifier';
      import { contains, field, CardDef, Component, type CardCrudFunctions } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";
      import { CardCrudFunctionsContextName } from '@cardstack/runtime-common';

      export class DefaultHeadCard extends CardDef {
        @field title = contains(StringField);

        static isolated = class Isolated extends Component<typeof this> {
          @consume(CardCrudFunctionsContextName) cardCrudFunctions: CardCrudFunctions | undefined;

          get customTarget() {
            try {
              return new URL('./custom-head-card', new URL(this.args.model?.id));
            } catch {
              return null;
            }
          }

          navigateTo(target: URL | null) {
            if (!target) {
              return;
            }
            this.cardCrudFunctions?.viewCard?.(target);
          }

          @action viewCustom() {
            this.navigateTo(this.customTarget);
          }

          <template>
            <article data-test-default-head-card>
              <h1>{{@model.title}}</h1>
              <button type="button" data-test-head-nav="custom" {{on "click" this.viewCustom}}>
                Go to custom head card
              </button>
            </article>
          </template>
        };
      }
    `;

    let customHeadCardSource = `
      import { action } from '@ember/object';
      import { consume } from 'ember-provide-consume-context';
      import { on } from '@ember/modifier';
      import { contains, field, CardDef, Component, type CardCrudFunctions } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";
      import { CardCrudFunctionsContextName } from '@cardstack/runtime-common';

      export class CustomHeadCard extends CardDef {
        @field title = contains(StringField);

        static head = class Head extends Component<typeof this> {
          get url() {
            return this.args.model?.id;
          }

          <template>
            <meta name='custom-head-flag' content='custom-head' />
            <meta property='og:title' content='Custom Head Title' />
            {{#if this.url}}
              <meta property='og:url' content={{this.url}} />
            {{/if}}
          </template>
        };

        static isolated = class Isolated extends Component<typeof this> {
          @consume(CardCrudFunctionsContextName) cardCrudFunctions: CardCrudFunctions | undefined;

          get defaultTarget() {
            try {
              return new URL('./default-head-card', new URL(this.args.model?.id));
            } catch {
              return null;
            }
          }

          navigateTo(target: URL | null) {
            if (!target) {
              return;
            }
            this.cardCrudFunctions?.viewCard?.(target);
          }

          @action viewDefault() {
            this.navigateTo(this.defaultTarget);
          }

          <template>
            <article data-test-custom-head-card>
              <h1>{{@model.title}}</h1>
              <button type="button" data-test-head-nav="default" {{on "click" this.viewDefault}}>
                Go to default head card
              </button>
            </article>
          </template>
        };
      }
    `;

    await postCardSource(
      page,
      realmURL,
      'default-head-card.gts',
      defaultHeadCardSource,
    );
    await postCardSource(
      page,
      realmURL,
      'custom-head-card.gts',
      customHeadCardSource,
    );

    await postCardSource(
      page,
      realmURL,
      'default-head-card.json',
      JSON.stringify(
        {
          data: {
            type: 'card',
            id: `${realmURL}default-head-card`,
            attributes: {
              title: 'Default Head Card',
            },
            meta: {
              adoptsFrom: {
                module: './default-head-card',
                name: 'DefaultHeadCard',
              },
            },
          },
        },
        null,
        2,
      ),
    );

    await postCardSource(
      page,
      realmURL,
      'custom-head-card.json',
      JSON.stringify(
        {
          data: {
            type: 'card',
            id: `${realmURL}custom-head-card`,
            attributes: {
              title: 'Custom Head Card',
            },
            meta: {
              adoptsFrom: {
                module: './custom-head-card',
                name: 'CustomHeadCard',
              },
            },
          },
        },
        null,
        2,
      ),
    );

    await openPublishRealmModal(page, displayName);
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();
    await page.waitForSelector('[data-test-unpublish-button]');

    let publishedRealmURL = `http://${user.username}.localhost:4205/${realmName}/`;
    let defaultCardURL = `${publishedRealmURL}default-head-card.json`;

    await page.goto(defaultCardURL);
    await expect(
      page.locator('head meta[property="og:title"]'),
    ).toHaveAttribute('content', 'Default Head Card');
    await expect(
      page.locator('head meta[name="custom-head-flag"]'),
    ).toHaveCount(0);

    await page.locator('[data-test-head-nav="custom"]').click();
    await expect(
      page.locator('head meta[name="custom-head-flag"]'),
    ).toHaveAttribute('content', 'custom-head');
    await expect(
      page.locator('head meta[property="og:title"]'),
    ).toHaveAttribute('content', 'Custom Head Title');

    await page.locator('[data-test-head-nav="default"]').click();
    await expect(page).toHaveURL(defaultCardURL);
    await expect(
      page.locator('head meta[name="custom-head-flag"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('head meta[property="og:title"]'),
    ).toHaveAttribute('content', 'Default Head Card');
  });
});
