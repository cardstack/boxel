import { setComponentTemplate } from '@ember/component';
import Service from '@ember/service';
import { precompileTemplate } from '@ember/template-compilation';
import {
  RenderingTestContext,
  click,
  fillIn,
  render,
} from '@ember/test-helpers';
import Component from '@glimmer/component';

import { module, test } from 'qunit';

import PublishRealmModal from '@cardstack/host/components/operator-mode/host-submode/publish-realm-modal';
import type { SubdomainAvailabilityResult } from '@cardstack/host/services/realm-server';

import { setupRenderingTest } from '../../helpers/setup';

type TestContext = RenderingTestContext & {
  siteNameResult?: SubdomainAvailabilityResult;
  lastCheckedSubdomain?: string;
  publishedUrls?: string[];
};

module(
  'Integration | Component | operator-mode/publish-realm-modal',
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.beforeEach(function (this: TestContext) {
      class StubRealmService extends Service {
        isUnpublishingRealm() {
          return false;
        }

        isUnpublishingAnyRealms() {
          return false;
        }

        isPublishing() {
          return false;
        }
      }

      class StubOperatorModeStateService extends Service {
        realmURL = new URL('http://localhost:4200/test-realm/');
        currentRealmInfo = { lastPublishedAt: null };
      }

      class StubMatrixService extends Service {
        userName = 'testuser';
      }

      const testContext = this;

      class StubRealmServerService extends Service {
        async checkSiteNameAvailability(subdomain: string) {
          testContext.lastCheckedSubdomain = subdomain;
          if (testContext.siteNameResult) {
            return testContext.siteNameResult;
          }

          return {
            available: true,
            hostname: `${subdomain}.boxel.dev.localhost`,
          } satisfies SubdomainAvailabilityResult;
        }
      }

      class StubWithLoadedRealm extends Component {
        realmContext = {
          info: {
            name: 'Stub Realm',
            iconURL: null,
            backgroundURL: null,
          },
        };
      }

      setComponentTemplate(
        precompileTemplate(`{{yield this.realmContext}}`, {
          strictMode: true,
          scope: () => ({}),
        }),
        StubWithLoadedRealm,
      );

      this.owner.register('service:realm', StubRealmService);
      this.owner.register(
        'service:operator-mode-state-service',
        StubOperatorModeStateService,
      );
      this.owner.register('service:matrix-service', StubMatrixService);
      this.owner.register('service:realm-server', StubRealmServerService);
      this.owner.register(
        'component:operator-mode/with-loaded-realm',
        StubWithLoadedRealm,
      );
    });

    test('it adds a claimed custom domain to the publish selection', async function (this: TestContext, assert) {
      assert.expect(9);

      const noop = () => {};
      const handlePublish = (urls: string[]) => {
        this.publishedUrls = urls;
      };

      await render(
        precompileTemplate(
          `<PublishRealmModal
            @isOpen={{true}}
            @onClose={{noop}}
            @handlePublish={{handlePublish}}
            @handleUnpublish={{noop}}
          />`,
          {
            strictMode: true,
            scope: () => ({ PublishRealmModal, noop, handlePublish }),
          },
        ),
      );

      assert.dom('[data-test-publish-button]').isDisabled();

      await click('[data-test-custom-site-name-setup-button]');
      await fillIn('[data-test-custom-site-name-input]', 'Bad Name');
      await click('[data-test-claim-custom-subdomain-button]');

      assert
        .dom('[data-test-custom-site-name-error]')
        .hasText(
          'Subdomain can only contain lowercase letters, numbers, and hyphens',
        );
      assert.strictEqual(
        this.lastCheckedSubdomain,
        undefined,
        'validation failure should not reach availability check',
      );

      await fillIn('[data-test-custom-site-name-input]', 'my-site');
      assert.dom('[data-test-custom-site-name-error]').doesNotExist();
      await click('[data-test-claim-custom-subdomain-button]');

      assert.strictEqual(this.lastCheckedSubdomain, 'my-site');

      assert
        .dom('[data-test-custom-site-name-availability]')
        .hasText('This name is available');

      assert.dom('[data-test-custom-domain-checkbox]').isChecked();
      assert.dom('[data-test-publish-button]').isEnabled();

      await click('[data-test-publish-button]');

      assert.deepEqual(this.publishedUrls, [
        'http://my-site.boxel.dev.localhost/test-realm/',
      ]);
    });

    test('it shows an error when the custom domain is unavailable', async function (this: TestContext, assert) {
      assert.expect(4);

      this.siteNameResult = {
        available: false,
        hostname: 'taken.boxel.dev.localhost',
        error: 'This name is already taken',
      };

      const noop = () => {};

      await render(
        precompileTemplate(
          `<PublishRealmModal
            @isOpen={{true}}
            @onClose={{noop}}
            @handlePublish={{noop}}
            @handleUnpublish={{noop}}
          />`,
          {
            strictMode: true,
            scope: () => ({ PublishRealmModal, noop }),
          },
        ),
      );

      await click('[data-test-custom-site-name-setup-button]');
      await fillIn('[data-test-custom-site-name-input]', 'taken');
      await click('[data-test-claim-custom-subdomain-button]');

      assert
        .dom('[data-test-custom-site-name-error]')
        .hasText('This name is already taken');

      assert.dom('[data-test-custom-domain-checkbox]').isNotChecked();
      assert.dom('[data-test-publish-button]').isDisabled();
      assert.strictEqual(this.lastCheckedSubdomain, 'taken');
    });
  },
);
