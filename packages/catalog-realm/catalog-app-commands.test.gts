import { waitFor, settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, skip, test } from 'qunit';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import ListingCreateCommand from '@cardstack/boxel-host/commands/listing-create';
import ListingInstallCommand from '@cardstack/boxel-host/commands/listing-install';
import ListingRemixCommand from '@cardstack/boxel-host/commands/listing-remix';
import ListingUseCommand from '@cardstack/boxel-host/commands/listing-use';

import ENV from '@cardstack/host/config/environment';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL as mockCatalogURL,
  setupAuthEndpoints,
  setupUserSubscription,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  verifySubmode,
  toggleFileTree,
  openDir,
  verifyFolderWithUUIDInFileTree,
  verifyFileInFileTree,
  verifyJSONWithUUIDInFolder,
  setupRealmServerEndpoints,
  setCatalogRealmURL,
} from '@cardstack/host/tests/helpers';
import { setupMockMatrix } from '@cardstack/host/tests/helpers/mock-matrix';
import { setupApplicationTest } from '@cardstack/host/tests/helpers/setup';

import type { CardListing } from '@cardstack/catalog/listing/listing';

import {
  makeMockCatalogContents,
  makeDestinationRealmContents,
} from './catalog-app-test-fixtures';

const catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);
const testDestinationRealmURL = `http://test-realm/test2/`;

//listing
const authorListingId = `${mockCatalogURL}Listing/author`;
const pirateSkillListingId = `${mockCatalogURL}SkillListing/pirate-skill`;
const apiDocumentationStubListingId = `${mockCatalogURL}Listing/api-documentation-stub`;
const themeListingId = `${mockCatalogURL}ThemeListing/cardstack-theme`;
const blogPostListingId = `${mockCatalogURL}Listing/blog-post`;
//license
const mitLicenseId = `${mockCatalogURL}License/mit`;
//category
const writingCategoryId = `${mockCatalogURL}Category/writing`;

//tags
const calculatorTagId = `${mockCatalogURL}Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7`;

export function runTests() {
  module(
    'Acceptance | Catalog | catalog app - commands tests',
    function (hooks) {
      setupApplicationTest(hooks);
      setupLocalIndexing(hooks);
      setupOnSave(hooks);

      let mockMatrixUtils = setupMockMatrix(hooks, {
        loggedInAs: '@testuser:localhost',
        activeRealms: [mockCatalogURL, testDestinationRealmURL],
      });

      let { createAndJoinRoom } = mockMatrixUtils;

      hooks.beforeEach(async function () {
        createAndJoinRoom({
          sender: '@testuser:localhost',
          name: 'room-test',
        });
        setupUserSubscription();
        setupAuthEndpoints();
        setCatalogRealmURL(mockCatalogURL, catalogRealmURL);
        // this setup test realm is pretending to be a mock catalog
        await setupAcceptanceTestRealm({
          realmURL: mockCatalogURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeMockCatalogContents(mockCatalogURL, catalogRealmURL),
          },
        });
        await setupAcceptanceTestRealm({
          mockMatrixUtils,
          realmURL: testDestinationRealmURL,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeDestinationRealmContents(),
          },
        });
      });

      /**
       * Waits for a card to appear on the stack with optional title verification
       */
      async function waitForCardOnStack(
        cardId: string,
        expectedTitle?: string,
      ) {
        await waitFor(
          `[data-test-stack-card="${cardId}"] [data-test-boxel-card-header-title]`,
        );
        if (expectedTitle) {
          await waitFor(
            `[data-test-stack-card="${cardId}"] [data-test-boxel-card-header-title]`,
          );
        }
      }

      async function executeCommand(
        commandClass:
          | typeof ListingUseCommand
          | typeof ListingInstallCommand
          | typeof ListingRemixCommand,
        listingUrl: string,
        realm: string,
      ) {
        const commandService = getService('command-service');
        const store = getService('store');

        const command = new commandClass(commandService.commandContext);
        const listing = (await store.get(listingUrl)) as CardDef;

        return command.execute({
          realm,
          listing,
        });
      }

      module('listing commands', function (hooks) {
        hooks.beforeEach(async function () {
          // we always run a command inside interact mode
          await visitOperatorMode({
            stacks: [[]],
          });
        });
        module('"build"', function () {
          test('card listing', async function (assert) {
            await visitOperatorMode({
              stacks: [
                [
                  {
                    id: apiDocumentationStubListingId,
                    format: 'isolated',
                  },
                ],
              ],
            });
            await waitFor(
              `[data-test-card="${apiDocumentationStubListingId}"]`,
            );
            assert
              .dom(
                `[data-test-card="${apiDocumentationStubListingId}"] [data-test-catalog-listing-action="Build"]`,
              )
              .containsText('Build', 'Build button exist in listing');
          });
        });
        module('"create"', function (hooks) {
          // Mock proxy LLM endpoint only for create-related tests
          setupRealmServerEndpoints(hooks, [
            {
              route: '_request-forward',
              getResponse: async (req: Request) => {
                try {
                  const body = await req.json();
                  if (
                    body.url === 'https://openrouter.ai/api/v1/chat/completions'
                  ) {
                    let requestBody: any = {};
                    try {
                      requestBody = body.requestBody
                        ? JSON.parse(body.requestBody)
                        : {};
                    } catch {
                      // ignore parse failure
                    }
                    const messages = requestBody.messages || [];
                    const system: string =
                      messages.find((m: any) => m.role === 'system')?.content ||
                      '';
                    const user: string =
                      messages.find((m: any) => m.role === 'user')?.content ||
                      '';
                    const systemLower = system.toLowerCase();
                    let content: string | undefined;
                    if (
                      systemLower.includes(
                        'respond only with one token: card, app, skill, or theme',
                      )
                    ) {
                      // Heuristic moved from production code into test mock:
                      // If the serialized example or prompts reference an App construct
                      // (e.g. AppCard base class, module paths with /App/, or a name ending with App)
                      // then classify as 'app'. If it references Skill, classify as 'skill'.
                      const userLower = user.toLowerCase();
                      if (
                        /(appcard|blogapp|"appcard"|\.appcard|name: 'appcard')/.test(
                          userLower,
                        )
                      ) {
                        content = 'app';
                      } else if (
                        /(cssvariables|css imports|theme card|themecreator|theme listing)/.test(
                          userLower,
                        )
                      ) {
                        content = 'theme';
                      } else if (/skill/.test(userLower)) {
                        content = 'skill';
                      } else {
                        content = 'card';
                      }
                    } else if (systemLower.includes('catalog listing title')) {
                      content = 'Mock Listing Title';
                    } else if (systemLower.includes('spec-style summary')) {
                      content = 'Mock listing summary sentence.';
                    } else if (
                      systemLower.includes("boxel's sample data assistant")
                    ) {
                      content = JSON.stringify({
                        examples: [
                          {
                            label: 'Generated field value',
                            url: 'https://example.com/contact',
                          },
                        ],
                      });
                    } else if (systemLower.includes('representing tag')) {
                      // Deterministic tag selection
                      content = JSON.stringify([calculatorTagId]);
                    } else if (systemLower.includes('representing category')) {
                      // Deterministic category selection
                      content = JSON.stringify([writingCategoryId]);
                    } else if (systemLower.includes('representing license')) {
                      // Deterministic license selection
                      content = JSON.stringify([mitLicenseId]);
                    }

                    return new Response(
                      JSON.stringify({
                        choices: [
                          {
                            message: {
                              content,
                            },
                          },
                        ],
                      }),
                      {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                      },
                    );
                  }
                } catch (e) {
                  return new Response(
                    JSON.stringify({
                      error: 'mock forward error',
                      details: (e as Error).message,
                    }),
                    {
                      status: 500,
                      headers: { 'Content-Type': 'application/json' },
                    },
                  );
                }
                return new Response(
                  JSON.stringify({ error: 'Unknown proxy path' }),
                  {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                  },
                );
              },
            },
          ]);
          test('card listing with single dependency module', async function (assert) {
            const cardId = mockCatalogURL + 'author/Author/example';
            const commandService = getService('command-service');
            const command = new ListingCreateCommand(
              commandService.commandContext,
            );
            const result = await command.execute({
              openCardId: cardId,
              codeRef: {
                module: `${mockCatalogURL}author/author.gts`,
                name: 'Author',
              },
              targetRealm: mockCatalogURL,
            });
            const interim = result?.listing as any;
            assert.ok(interim, 'Interim listing exists');
            assert.strictEqual((interim as any).name, 'Mock Listing Title');
            assert.strictEqual(
              (interim as any).summary,
              'Mock listing summary sentence.',
            );
            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${mockCatalogURL}index`,
            });
            await verifySubmode(assert, 'code');
            const instanceFolder = 'CardListing/';
            await openDir(assert, instanceFolder);
            const listingId = await verifyJSONWithUUIDInFolder(
              assert,
              instanceFolder,
            );
            if (listingId) {
              const listing = (await getService('store').get(
                listingId,
              )) as CardListing;
              assert.ok(listing, 'Listing should be created');
              // Assertions for AI generated fields coming from proxy mock
              assert.strictEqual(
                (listing as any).name,
                'Mock Listing Title',
                'Listing name populated from autoPatchName mock response',
              );
              assert.strictEqual(
                (listing as any).summary,
                'Mock listing summary sentence.',
                'Listing summary populated from autoPatchSummary mock response',
              );
              assert.strictEqual(
                listing.specs.length,
                2,
                'Listing should have two specs',
              );
              assert.true(
                listing.specs.some((spec) => spec.ref.name === 'Author'),
                'Listing should have an Author spec',
              );
              assert.true(
                listing.specs.some((spec) => spec.ref.name === 'AuthorCompany'),
                'Listing should have an AuthorCompany spec',
              );
              // Deterministic autoLink assertions from proxy mock
              assert.ok((listing as any).license, 'License linked');
              assert.strictEqual(
                (listing as any).license.id,
                mitLicenseId,
                'License id matches mitLicenseId',
              );
              assert.ok(
                Array.isArray((listing as any).tags),
                'Tags array exists',
              );
              assert.true(
                (listing as any).tags.some(
                  (t: any) => t.id === calculatorTagId,
                ),
                'Contains calculator tag id',
              );
              assert.ok(
                Array.isArray((listing as any).categories),
                'Categories array exists',
              );
              assert.true(
                (listing as any).categories.some(
                  (c: any) => c.id === writingCategoryId,
                ),
                'Contains writing category id',
              );
            }
          });

          test('listing will only create specs with recognised imports from realms it can read from', async function (assert) {
            const cardId = mockCatalogURL + 'UnrecognisedImports/example';
            const commandService = getService('command-service');
            const command = new ListingCreateCommand(
              commandService.commandContext,
            );
            await command.execute({
              openCardId: cardId,
              codeRef: {
                module: `${mockCatalogURL}card-with-unrecognised-imports.gts`,
                name: 'UnrecognisedImports',
              },
              targetRealm: mockCatalogURL,
            });
            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${mockCatalogURL}index`,
            });
            await verifySubmode(assert, 'code');
            const instanceFolder = 'CardListing/';
            await openDir(assert, instanceFolder);
            const listingId = await verifyJSONWithUUIDInFolder(
              assert,
              instanceFolder,
            );
            if (listingId) {
              const listing = (await getService('store').get(
                listingId,
              )) as CardListing;
              assert.ok(listing, 'Listing should be created');
              assert.true(
                listing.specs.every(
                  (spec) =>
                    spec.ref.module !=
                    'https://cdn.jsdelivr.net/npm/chess.js/+esm',
                ),
                'Listing should does not have unrecognised import',
              );
            }
          });

          test('app listing', async function (assert) {
            const cardId = mockCatalogURL + 'blog-app/BlogApp/example';
            const commandService = getService('command-service');
            const command = new ListingCreateCommand(
              commandService.commandContext,
            );
            const createResult = await command.execute({
              openCardId: cardId,
              codeRef: {
                module: `${mockCatalogURL}blog-app/blog-app.gts`,
                name: 'BlogApp',
              },
              targetRealm: testDestinationRealmURL,
            });
            // Assert store-level (in-memory) results BEFORE navigating to code mode
            let immediateListing = createResult?.listing as any;
            assert.ok(immediateListing, 'Listing object returned from command');
            assert.strictEqual(
              immediateListing.name,
              'Mock Listing Title',
              'Immediate listing has patched name before persistence',
            );
            assert.strictEqual(
              immediateListing.summary,
              'Mock listing summary sentence.',
              'Immediate listing has patched summary before persistence',
            );
            assert.ok(
              immediateListing.license,
              'Immediate listing has linked license before persistence',
            );
            assert.strictEqual(
              immediateListing.license?.id,
              mitLicenseId,
              'Immediate listing license id matches mitLicenseId',
            );
            // Lint: avoid logical expression inside assertion
            assert.ok(
              Array.isArray(immediateListing.tags),
              'Immediate listing tags is an array before persistence',
            );
            if (Array.isArray(immediateListing.tags)) {
              assert.ok(
                immediateListing.tags.length > 0,
                'Immediate listing has linked tag(s) before persistence',
              );
            }
            assert.true(
              immediateListing.tags.some((t: any) => t.id === calculatorTagId),
              'Immediate listing includes calculator tag id',
            );
            assert.ok(
              Array.isArray(immediateListing.categories),
              'Immediate listing categories is an array before persistence',
            );
            if (Array.isArray(immediateListing.categories)) {
              assert.ok(
                immediateListing.categories.length > 0,
                'Immediate listing has linked category(ies) before persistence',
              );
            }
            assert.true(
              immediateListing.categories.some(
                (c: any) => c.id === writingCategoryId,
              ),
              'Immediate listing includes writing category id',
            );
            assert.ok(
              Array.isArray(immediateListing.specs),
              'Immediate listing specs is an array before persistence',
            );
            if (Array.isArray(immediateListing.specs)) {
              assert.strictEqual(
                immediateListing.specs.length,
                5,
                'Immediate listing has expected number of specs before persistence',
              );
            }
            assert.ok(
              Array.isArray(immediateListing.examples),
              'Immediate listing examples is an array before persistence',
            );
            if (Array.isArray(immediateListing.examples)) {
              assert.strictEqual(
                immediateListing.examples.length,
                1,
                'Immediate listing has expected examples before persistence',
              );
            }
            // Header/title: wait for persisted id (listing.id) then assert via stack card selector
            const persistedId = immediateListing.id;
            assert.ok(persistedId, 'Immediate listing has a persisted id');
            await waitForCardOnStack(persistedId);
            assert
              .dom(
                `[data-test-stack-card="${persistedId}"] [data-test-boxel-card-header-title]`,
              )
              .containsText(
                'Mock Listing Title',
                'Isolated view shows patched name (persisted id)',
              );
            // Summary section
            assert
              .dom('[data-test-catalog-listing-embedded-summary-section]')
              .containsText(
                'Mock listing summary sentence.',
                'Isolated view shows patched summary',
              );

            // License section should not show fallback text
            assert
              .dom('[data-test-catalog-listing-embedded-license-section]')
              .doesNotContainText(
                'No License Provided',
                'License section populated (autoLinkLicense)',
              );

            // Tags section
            assert
              .dom('[data-test-catalog-listing-embedded-tags-section]')
              .doesNotContainText(
                'No Tags Provided',
                'Tags section populated (autoLinkTag)',
              );

            // Categories section
            assert
              .dom('[data-test-catalog-listing-embedded-categories-section]')
              .doesNotContainText(
                'No Categories Provided',
                'Categories section populated (autoLinkCategory)',
              );
            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${testDestinationRealmURL}index`,
            });
            await verifySubmode(assert, 'code');
            const instanceFolder = 'AppListing/';
            await openDir(assert, instanceFolder);
            const persistedListingId = await verifyJSONWithUUIDInFolder(
              assert,
              instanceFolder,
            );
            if (persistedListingId) {
              const listing = (await getService('store').get(
                persistedListingId,
              )) as CardListing;
              assert.ok(listing, 'Listing should be created');
              assert.strictEqual(
                listing.specs.length,
                5,
                'Listing should have five specs',
              );
              [
                'Author',
                'AuthorCompany',
                'BlogPost',
                'BlogApp',
                'AppCard',
              ].forEach((specName) => {
                assert.true(
                  listing.specs.some((spec) => spec.ref.name === specName),
                  `Listing should have a ${specName} spec`,
                );
              });
              assert.strictEqual(
                listing.examples.length,
                1,
                'Listing should have one example',
              );

              // Assert autoPatch fields populated (from proxy mock responses)
              assert.strictEqual(
                (listing as any).name,
                'Mock Listing Title',
                'autoPatchName populated listing.name',
              );
              assert.strictEqual(
                (listing as any).summary,
                'Mock listing summary sentence.',
                'autoPatchSummary populated listing.summary',
              );

              // Basic object-level sanity for autoLink fields (they should exist, may be arrays)
              assert.ok(
                (listing as any).license,
                'autoLinkLicense populated listing.license',
              );
              assert.strictEqual(
                (listing as any).license?.id,
                mitLicenseId,
                'Persisted listing license id matches mitLicenseId',
              );
              assert.ok(
                Array.isArray((listing as any).tags),
                'autoLinkTag populated listing.tags array',
              );
              if (Array.isArray((listing as any).tags)) {
                assert.ok(
                  (listing as any).tags.length > 0,
                  'autoLinkTag populated listing.tags with at least one tag',
                );
              }
              assert.true(
                (listing as any).tags.some(
                  (t: any) => t.id === calculatorTagId,
                ),
                'Persisted listing includes calculator tag id',
              );
              assert.ok(
                Array.isArray((listing as any).categories),
                'autoLinkCategory populated listing.categories array',
              );
              if (Array.isArray((listing as any).categories)) {
                assert.ok(
                  (listing as any).categories.length > 0,
                  'autoLinkCategory populated listing.categories with at least one category',
                );
              }
              assert.true(
                (listing as any).categories.some(
                  (c: any) => c.id === writingCategoryId,
                ),
                'Persisted listing includes writing category id',
              );
            }
          });

          test('after create command, listing card opens on stack in interact mode', async function (assert) {
            const cardId = mockCatalogURL + 'author/Author/example';
            const commandService = getService('command-service');
            const command = new ListingCreateCommand(
              commandService.commandContext,
            );

            let r = await command.execute({
              openCardId: cardId,
              codeRef: {
                module: `${mockCatalogURL}author/author.gts`,
                name: 'Author',
              },
              targetRealm: mockCatalogURL,
            });

            await verifySubmode(assert, 'interact');
            const listing = r?.listing as any;
            const createdId = listing.id;
            assert.ok(createdId, 'Listing id should be present');
            await waitForCardOnStack(createdId);
            assert
              .dom(`[data-test-stack-card="${createdId}"]`)
              .exists(
                'Created listing card (by persisted id) is displayed on stack after command execution',
              );
          });
        });
        skip('"use"', async function () {
          skip('card listing', async function (assert) {
            const listingName = 'author';
            const listingId = mockCatalogURL + 'Listing/author.json';
            await executeCommand(
              ListingUseCommand,
              listingId,
              testDestinationRealmURL,
            );
            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${testDestinationRealmURL}index`,
            });
            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );

            let instanceFolder = `${outerFolder}Author/`;
            await openDir(assert, instanceFolder);
            await verifyJSONWithUUIDInFolder(assert, instanceFolder);
          });
        });
        module('"install"', function () {
          test('card listing', async function (assert) {
            const listingName = 'author';

            await executeCommand(
              ListingInstallCommand,
              authorListingId,
              testDestinationRealmURL,
            );
            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${testDestinationRealmURL}index`,
            });

            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );
            let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
            await openDir(assert, gtsFilePath);
            await verifyFileInFileTree(assert, gtsFilePath);
            let examplePath = `${outerFolder}${listingName}/Author/example.json`;
            await openDir(assert, examplePath);
            await verifyFileInFileTree(assert, examplePath);
          });

          test('listing installs relationships of examples and its modules', async function (assert) {
            const listingName = 'blog-post';

            await executeCommand(
              ListingInstallCommand,
              blogPostListingId,
              testDestinationRealmURL,
            );
            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${testDestinationRealmURL}index`,
            });

            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );
            let blogPostModulePath = `${outerFolder}blog-post/blog-post.gts`;
            let authorModulePath = `${outerFolder}author/author.gts`;
            await openDir(assert, blogPostModulePath);
            await verifyFileInFileTree(assert, blogPostModulePath);
            await openDir(assert, authorModulePath);
            await verifyFileInFileTree(assert, authorModulePath);

            let blogPostExamplePath = `${outerFolder}blog-post/BlogPost/example.json`;
            let authorExamplePath = `${outerFolder}author/Author/example.json`;
            let authorCompanyExamplePath = `${outerFolder}author/AuthorCompany/example.json`;
            await openDir(assert, blogPostExamplePath);
            await verifyFileInFileTree(assert, blogPostExamplePath);
            await openDir(assert, authorExamplePath);
            await verifyFileInFileTree(assert, authorExamplePath);
            await openDir(assert, authorCompanyExamplePath);
            await verifyFileInFileTree(assert, authorCompanyExamplePath);
          });

          test('field listing', async function (assert) {
            const listingName = 'contact-link';
            const contactLinkFieldListingCardId = `${mockCatalogURL}FieldListing/contact-link`;

            await executeCommand(
              ListingInstallCommand,
              contactLinkFieldListingCardId,
              testDestinationRealmURL,
            );

            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${testDestinationRealmURL}index`,
            });

            // contact-link-[uuid]/
            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );
            await openDir(assert, `${outerFolder}fields/contact-link.gts`);
            let gtsFilePath = `${outerFolder}fields/contact-link.gts`;
            await verifyFileInFileTree(assert, gtsFilePath);
          });

          test('skill listing', async function (assert) {
            const listingName = 'pirate-skill';
            const listingId = `${mockCatalogURL}SkillListing/${listingName}`;
            await executeCommand(
              ListingInstallCommand,
              listingId,
              testDestinationRealmURL,
            );
            await visitOperatorMode({
              submode: 'code',
              fileView: 'browser',
              codePath: `${testDestinationRealmURL}index`,
            });

            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );
            let instancePath = `${outerFolder}Skill/pirate-speak.json`;
            await openDir(assert, instancePath);
            await verifyFileInFileTree(assert, instancePath);
          });
        });
        module('"remix"', function () {
          test('card listing: installs the card and redirects to code mode with persisted playground selection for first example successfully', async function (assert) {
            const listingName = 'author';
            const listingId = `${mockCatalogURL}Listing/${listingName}`;
            await visitOperatorMode({
              stacks: [[]],
            });
            await executeCommand(
              ListingRemixCommand,
              listingId,
              testDestinationRealmURL,
            );
            await settled();
            await verifySubmode(assert, 'code');
            await toggleFileTree();
            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );
            let instanceFile = `${outerFolder}${listingName}/Author/example.json`;
            await openDir(assert, instanceFile);
            await verifyFileInFileTree(assert, instanceFile);
            let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
            await openDir(assert, gtsFilePath);
            await verifyFileInFileTree(assert, gtsFilePath);
            await settled();
            assert
              .dom(
                '[data-test-playground-panel] [data-test-boxel-card-header-title]',
              )
              .hasText('Author - Mike Dane');
          });
          test('skill listing: installs the card and redirects to code mode with preview on first skill successfully', async function (assert) {
            const listingName = 'pirate-skill';
            const listingId = `${mockCatalogURL}SkillListing/${listingName}`;
            await executeCommand(
              ListingRemixCommand,
              listingId,
              testDestinationRealmURL,
            );
            await settled();
            await verifySubmode(assert, 'code');
            await toggleFileTree();
            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );
            let instancePath = `${outerFolder}Skill/pirate-speak.json`;
            await openDir(assert, instancePath);
            await verifyFileInFileTree(assert, instancePath);
            let cardId =
              testDestinationRealmURL + instancePath.replace('.json', '');
            await waitFor('[data-test-card-resource-loaded]');
            assert
              .dom(`[data-test-code-mode-card-renderer-header="${cardId}"]`)
              .exists();
          });
          test('theme listing: installs the theme example and redirects to code mode successfully', async function (assert) {
            const listingName = 'cardstack-theme';
            await executeCommand(
              ListingRemixCommand,
              themeListingId,
              testDestinationRealmURL,
            );
            await settled();
            await verifySubmode(assert, 'code');
            await toggleFileTree();
            let outerFolder = await verifyFolderWithUUIDInFileTree(
              assert,
              listingName,
            );
            let instancePath = `${outerFolder}theme/theme-example.json`;
            await openDir(assert, instancePath);
            await verifyFileInFileTree(assert, instancePath);
            let cardId =
              testDestinationRealmURL + instancePath.replace('.json', '');
            await waitFor('[data-test-card-resource-loaded]');
            assert
              .dom(`[data-test-code-mode-card-renderer-header="${cardId}"]`)
              .exists();
          });
        });

        skip('"use" is successful even if target realm does not have a trailing slash', async function (assert) {
          const listingName = 'author';
          const listingId = mockCatalogURL + 'Listing/author.json';
          await executeCommand(
            ListingUseCommand,
            listingId,
            removeTrailingSlash(testDestinationRealmURL),
          );
          await visitOperatorMode({
            submode: 'code',
            fileView: 'browser',
            codePath: `${testDestinationRealmURL}index`,
          });
          let outerFolder = await verifyFolderWithUUIDInFileTree(
            assert,
            listingName,
          );

          let instanceFolder = `${outerFolder}Author`;
          await openDir(assert, instanceFolder);
          await verifyJSONWithUUIDInFolder(assert, instanceFolder);
        });

        test('"install" is successful even if target realm does not have a trailing slash', async function (assert) {
          const listingName = 'author';
          await executeCommand(
            ListingInstallCommand,
            authorListingId,
            removeTrailingSlash(testDestinationRealmURL),
          );
          await visitOperatorMode({
            submode: 'code',
            fileView: 'browser',
            codePath: `${testDestinationRealmURL}index`,
          });

          let outerFolder = await verifyFolderWithUUIDInFileTree(
            assert,
            listingName,
          );

          let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
          await openDir(assert, gtsFilePath);
          await verifyFileInFileTree(assert, gtsFilePath);
          let instancePath = `${outerFolder}${listingName}/Author/example.json`;

          await openDir(assert, instancePath);
          await verifyFileInFileTree(assert, instancePath);
        });

        test('"remix" is successful even if target realm does not have a trailing slash', async function (assert) {
          const listingName = 'author';
          const listingId = `${mockCatalogURL}Listing/${listingName}`;
          await visitOperatorMode({
            stacks: [[]],
          });
          await executeCommand(
            ListingRemixCommand,
            listingId,
            removeTrailingSlash(testDestinationRealmURL),
          );
          await settled();
          await verifySubmode(assert, 'code');
          await toggleFileTree();
          let outerFolder = await verifyFolderWithUUIDInFileTree(
            assert,
            listingName,
          );
          let instancePath = `${outerFolder}${listingName}/Author/example.json`;
          await openDir(assert, instancePath);
          await verifyFileInFileTree(assert, instancePath);
          let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
          await openDir(assert, gtsFilePath);
          await verifyFileInFileTree(assert, gtsFilePath);
          await settled();
          assert
            .dom(
              '[data-test-playground-panel] [data-test-boxel-card-header-title]',
            )
            .hasText('Author - Mike Dane');
        });
      });
    },
  );
}

function removeTrailingSlash(url: string): string {
  if (url === undefined || url === null) {
    throw new Error(`removeTrailingSlash called with invalid url: ${url}`);
  }
  return url.endsWith('/') && url.length > 1 ? url.slice(0, -1) : url;
}
