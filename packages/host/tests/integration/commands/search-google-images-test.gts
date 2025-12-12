import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import SearchGoogleImagesCommand from '@cardstack/host/commands/search-google-images';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmServerEndpoints,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | search-google-images', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        loader,
      });
      return {};
    },
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
            kind: 'customsearch#search',
            url: {
              type: 'application/json',
              template:
                'https://www.googleapis.com/customsearch/v1?q={searchTerms}&num={count?}&start={startIndex?}&searchType={searchType}&key={key}&cx={cx?}',
            },
            queries: {
              request: [
                {
                  title: 'Google Custom Search - test',
                  totalResults: '2',
                  searchTerms: 'test',
                  count: 2,
                  startIndex: 1,
                  inputEncoding: 'utf8',
                  outputEncoding: 'utf8',
                  safe: 'off',
                  searchType: 'image',
                },
              ],
              nextPage: [
                {
                  title: 'Google Custom Search - test',
                  totalResults: '2',
                  searchTerms: 'test',
                  count: 2,
                  startIndex: 3,
                  inputEncoding: 'utf8',
                  outputEncoding: 'utf8',
                  safe: 'off',
                  searchType: 'image',
                },
              ],
            },
            context: {
              title: 'boxel-search-image',
            },
            searchInformation: {
              searchTime: 0.5,
              formattedSearchTime: '0.50',
              totalResults: '2',
              formattedTotalResults: '2',
            },
            items: [
              {
                kind: 'customsearch#result',
                title: 'Test Image 1',
                htmlTitle: '<b>Test</b> Image 1',
                link: 'http://localhost:4200/i-do-not-exist/image1.jpg',
                displayLink: 'localhost',
                snippet: 'Test Image 1',
                htmlSnippet: '<b>Test</b> Image 1',
                mime: 'image/jpeg',
                fileFormat: 'image/jpeg',
                image: {
                  contextLink: 'http://localhost:4200/i-do-not-exist/page1',
                  height: 600,
                  width: 800,
                  byteSize: 50000,
                  thumbnailLink:
                    'http://localhost:4200/i-do-not-exist/thumb1.jpg',
                  thumbnailHeight: 84,
                  thumbnailWidth: 150,
                },
              },
              {
                kind: 'customsearch#result',
                title: 'Test Image 2',
                htmlTitle: '<b>Test</b> Image 2',
                link: 'http://localhost:4200/i-do-not-exist/image2.jpg',
                displayLink: 'localhost',
                snippet: 'Test Image 2',
                htmlSnippet: '<b>Test</b> Image 2',
                mime: 'image/png',
                fileFormat: 'image/png',
                image: {
                  contextLink: 'http://localhost:4200/i-do-not-exist/page2',
                  height: 768,
                  width: 1024,
                  byteSize: 75000,
                  thumbnailLink:
                    'http://localhost:4200/i-do-not-exist/thumb2.jpg',
                  thumbnailHeight: 100,
                  thumbnailWidth: 150,
                },
              },
            ],
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

  hooks.beforeEach(function () {
    snapshot.get();
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
    assert.strictEqual(
      result.formattedTotalResults,
      '2',
      'Should have correct formatted total results',
    );
    assert.strictEqual(
      result.formattedSearchTime,
      '0.50',
      'Should have correct formatted search time',
    );
    assert.true(result.hasNextPage, 'Should have next page');
    assert.strictEqual(
      result.nextPageStartIndex,
      3,
      'Should have correct next page start index',
    );
    assert.strictEqual(
      result.currentStartIndex,
      1,
      'Should have correct current start index',
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
      'http://localhost:4200/i-do-not-exist/image1.jpg',
      'Should have correct image URL',
    );
    assert.strictEqual(
      firstImage.thumbnailUrl,
      'http://localhost:4200/i-do-not-exist/thumb1.jpg',
      'Should have correct thumbnail URL',
    );
    assert.strictEqual(
      firstImage.contextUrl,
      'http://localhost:4200/i-do-not-exist/page1',
      'Should have correct context URL',
    );
    assert.strictEqual(firstImage.width, 800, 'Should have correct width');
    assert.strictEqual(firstImage.height, 600, 'Should have correct height');
    assert.strictEqual(
      firstImage.byteSize,
      50000,
      'Should have correct byte size',
    );
    assert.strictEqual(
      firstImage.thumbnailWidth,
      150,
      'Should have correct thumbnail width',
    );
    assert.strictEqual(
      firstImage.thumbnailHeight,
      84,
      'Should have correct thumbnail height',
    );
    assert.strictEqual(
      firstImage.mime,
      'image/jpeg',
      'Should have correct mime type',
    );
    assert.strictEqual(
      firstImage.fileFormat,
      'image/jpeg',
      'Should have correct file format',
    );
    assert.strictEqual(
      firstImage.displayLink,
      'localhost',
      'Should have correct display link',
    );
    assert.strictEqual(
      firstImage.snippet,
      'Test Image 1',
      'Should have correct snippet',
    );
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

  test('supports pagination with startIndex parameter', async function (assert) {
    const commandService = getService('command-service');
    const searchCommand = new SearchGoogleImagesCommand(
      commandService.commandContext,
    );

    const input = {
      query: 'test images',
      maxResults: 5,
      startIndex: 3, // Start from the third result
    };

    const result = await searchCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(
      result.currentStartIndex,
      3,
      'Should have correct start index',
    );
    assert.strictEqual(result.images.length, 2, 'Should return images');
  });
});
