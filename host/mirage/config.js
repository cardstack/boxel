import { Response } from 'miragejs';

export default function () {
  this.get('http://test-realm/_typeOf', (_schema, request) => {
    return handleScaffoldedTypeOf(request, [
      {
        cardRefs: [
          {
            type: 'exportedCard',
            module: 'http://test-realm/person.gts',
            name: 'Person',
          },
          {
            type: 'exportedCard',
            module: 'http://test-realm/person',
            name: 'Person',
          },
        ],
        response: {
          data: {
            id: 'http://test-realm/person/Person',
            type: 'card-definition',
            relationships: {
              _super: {
                links: {
                  related:
                    'https://cardstack.com/base/_typeOf?type=exportedCard&module=https%3A%2F%2Fcardstack.com%2Fbase%2Fcard-api&name=Card',
                },
                meta: {
                  type: 'super',
                },
              },
              firstName: {
                links: {
                  related:
                    'https://cardstack.com/base/_typeOf?type=exportedCard&module=https%3A%2F%2Fcardstack.com%2Fbase%2Fstring&name=default',
                },
                meta: {
                  type: 'contains',
                },
              },
            },
          },
        },
      },
      {
        cardRefs: [
          {
            type: 'exportedCard',
            module: 'http://test-realm/post.gts',
            name: 'Post',
          },
          {
            type: 'exportedCard',
            module: 'http://test-realm/post',
            name: 'Post',
          },
        ],
        response: {
          data: {
            id: 'http://test-realm/post/Post',
            type: 'card-definition',
            relationships: {
              _super: {
                links: {
                  related:
                    'https://cardstack.com/base/_typeOf?type=exportedCard&module=https%3A%2F%2Fcardstack.com%2Fbase%2Fcard-api&name=Card',
                },
                meta: {
                  type: 'super',
                },
              },
              author: {
                links: {
                  related:
                    'http://test-realm/_typeOf?type=exportedCard&module=http%3A%2F%2Ftest-realm%2Fperson&name=Person',
                },
                meta: {
                  type: 'contains',
                },
              },
              title: {
                links: {
                  related:
                    'https://cardstack.com/base/_typeOf?type=exportedCard&module=https%3A%2F%2Fcardstack.com%2Fbase%2Fstring&name=default',
                },
                meta: {
                  type: 'contains',
                },
              },
            },
          },
        },
      },
    ]);
  });

  this.get('https://cardstack.com/base/_typeOf', (_schema, request) => {
    return handleScaffoldedTypeOf(request, [
      {
        cardRefs: [
          {
            type: 'exportedCard',
            module: 'https://cardstack.com/base/card-api',
            name: 'Card',
          },
        ],
        response: {
          data: {
            id: 'https://cardstack.com/base/card-api/Card',
            type: 'card-definition',
            relationships: {},
          },
        },
      },
      {
        cardRefs: [
          {
            type: 'exportedCard',
            module: 'https://cardstack.com/base/string',
            name: 'default',
          },
        ],
        response: {
          data: {
            id: 'https://cardstack.com/base/string/default',
            type: 'card-definition',
            relationships: {
              _super: {
                links: {
                  related:
                    'https://cardstack.com/base/_typeOf?type=exportedCard&module=https%3A%2F%2Fcardstack.com%2Fbase%2Fcard-api&name=Card',
                },
                meta: {
                  type: 'super',
                },
              },
            },
          },
        },
      },
    ]);
  });
}

function handleScaffoldedTypeOf(request, stubs) {
  let cardRef = request.queryParams;
  if (cardRef.type !== 'exportedCard') {
    return notFound(
      request,
      `Could not find card reference ${JSON.stringify(cardRef)}`
    );
  }
  for (let { cardRefs, response } of stubs) {
    for (let ref of cardRefs) {
      let { module, type, name } = ref; // Assumes that the card ref type is "exportedCard"
      if (
        cardRef.type === type &&
        cardRef.name === name &&
        cardRef.module === module
      ) {
        return response;
      }
    }
  }

  return notFound(
    request,
    `Could not find card reference ${JSON.stringify(cardRef)}`
  );
}

export function notFound(request, message = `Could not find ${request.url}`) {
  return new Response(
    404,
    { 'Content-Type': 'application/vnd.api+json' },

    {
      errors: [message],
    }
  );
}
