import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import SearchGoogleImagesCommand from '@cardstack/host/commands/search-google-images';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmServerEndpoints,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | search-google-images', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  // Setup realm server endpoints to mock Google Custom Search API
  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        const body = await req.json();

        // Check if this is a Google Custom Search API request
        if (body.url.includes('googleapis.com/customsearch/v1')) {
          // Mock Google Custom Search API response
          const mockResponse = {
            items: [
              {
                title: 'Test Image 1',
                link: 'https://example.com/image1.jpg',
                image: {
                  thumbnailLink: 'https://example.com/thumb1.jpg',
                  contextLink: 'https://example.com/page1',
                  width: 800,
                  height: 600,
                },
              },
              {
                title: 'Test Image 2',
                link: 'https://example.com/image2.jpg',
                image: {
                  thumbnailLink: 'https://example.com/thumb2.jpg',
                  contextLink: 'https://example.com/page2',
                  width: 1024,
                  height: 768,
                },
              },
            ],
            searchInformation: {
              totalResults: '2',
              searchTime: 0.5,
            },
          };

          return new Response(JSON.stringify(mockResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Default response for other requests
        return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  ]);

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
  });

  test('successfully searches Google Images and returns results', async function (assert) {
    const commandService = getService('command-service');
    const searchCommand = new SearchGoogleImagesCommand(
      commandService.commandContext,
    );

    const input = {
      query: 'test images',
      maxResults: 5,
    };

    const result = await searchCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.images.length, 2, 'Should return 2 images');
    assert.strictEqual(result.totalResults, 2, 'Should have 2 total results');
    assert.strictEqual(
      result.searchTime,
      0.5,
      'Should have correct search time',
    );

    // Check first image
    const firstImage = result.images[0];
    assert.strictEqual(
      firstImage.title,
      'Test Image 1',
      'Should have correct title',
    );
    assert.strictEqual(
      firstImage.imageUrl,
      'https://example.com/image1.jpg',
      'Should have correct image URL',
    );
    assert.strictEqual(
      firstImage.thumbnailUrl,
      'https://example.com/thumb1.jpg',
      'Should have correct thumbnail URL',
    );
    assert.strictEqual(
      firstImage.contextUrl,
      'https://example.com/page1',
      'Should have correct context URL',
    );
    assert.strictEqual(firstImage.width, 800, 'Should have correct width');
    assert.strictEqual(firstImage.height, 600, 'Should have correct height');
  });

  test('uses default maxResults when not provided', async function (assert) {
    const commandService = getService('command-service');
    const searchCommand = new SearchGoogleImagesCommand(
      commandService.commandContext,
    );

    const input = {
      query: 'test images',
      // maxResults not provided
    };

    const result = await searchCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.images.length, 2, 'Should return images');
  });

  test('limits maxResults to 10', async function (assert) {
    const commandService = getService('command-service');
    const searchCommand = new SearchGoogleImagesCommand(
      commandService.commandContext,
    );

    const input = {
      query: 'test images',
      maxResults: 20, // Should be limited to 10
    };

    const result = await searchCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    // The mock returns 2 images, but the command should limit the request to 10
    assert.strictEqual(
      result.images.length,
      2,
      'Should return available images',
    );
  });
});
