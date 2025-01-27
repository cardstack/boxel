import { click, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupServerSentEvents,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

module('Integration | code-submode | playground panel', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:staging',
    activeRealms: [testRealmURL],
  });

  const authorCard = `
  import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
  import MarkdownField from 'https://cardstack.com/base/markdown';
  import StringField from "https://cardstack.com/base/string";
  export class Author extends CardDef {
    static displayName = 'Author';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field bio = contains(MarkdownField);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
  }
`;
  const blogPostCard = `
  import { contains, field, linksTo, CardDef } from "https://cardstack.com/base/card-api";
  import DatetimeField from 'https://cardstack.com/base/datetime';
  import MarkdownField from 'https://cardstack.com/base/markdown';
  import StringField from "https://cardstack.com/base/string";
  import { Author } from './author';

  class Status extends StringField {
    static displayName = 'Status';
  }

  export class BlogPost extends CardDef {
    static displayName = 'Blog Post';
    @field publishDate = contains(DatetimeField);
    @field author = linksTo(Author);
    @field body = contains(MarkdownField);
    @field status = contains(Status, {
      computeVia: function (this: BlogPost) {
        if (!this.publishDate) {
          return 'Draft';
        }
        if (Date.now() >= Date.parse(String(this.publishDate))) {
          return 'Published';
        }
        return 'Scheduled';
      },
    });
  }
`;

  hooks.beforeEach(async function () {
    await setupAcceptanceTestRealm({
      contents: {
        'author.gts': authorCard,
        'blog-post.gts': blogPostCard,
        'Author/jane-doe.json': {
          data: {
            attributes: {
              firstName: 'Jane',
              lastName: 'Doe',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}author`,
                name: 'Author',
              },
            },
          },
        },
        'BlogPost/remote-work.json': {
          data: {
            attributes: {
              title: 'The Ultimate Guide to Remote Work',
              description:
                'In today’s digital age, remote work has transformed from a luxury to a necessity. This comprehensive guide will help you navigate the world of remote work, offering tips, tools, and best practices for success.',
            },
            relationships: {
              author: {
                links: {
                  self: `${testRealmURL}Author/jane-doe`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}blog-post`,
                name: 'BlogPost',
              },
            },
          },
        },
      },
    });
  });

  test('can render playground panel when a card def is selected', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    await waitFor('[data-test-accordion-item="schema-editor"]');
    assert
      .dom(
        '[data-test-in-this-file-selector] [data-test-boxel-selector-item-selected] [data-test-boxel-selector-item-text="Status"]',
      )
      .exists();
    assert.dom('[data-test-accordion-item="playground"]').doesNotExist();

    await click(
      '[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="BlogPost"]',
    );
    await click('[data-test-accordion-item="playground"] button');
    assert.dom('[data-test-playground-panel]').exists();
  });
});
