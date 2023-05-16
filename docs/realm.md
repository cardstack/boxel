# Realm

A Realm is a URL-oriented place to store files. Files can be code, data, or assets.

It provides a file server that enables reading, mutating or deleting source code of cards, or data in JSON blobs.

The capabilites of the realm are:

1. Listing directories
2. Creating card data or source code
3. Responding with card data or source code
4. Updating card data or source code
5. Deleting card data or source code
6. Filtering (searching) cards using query parameters
7. Subscribing to SSE (Server Sent Events)

The entry point that serves these requests `handle` function in `realm.ts` file. Depending on the `Accept` header (the recognized ones are `application/vnd.card+json`, `application/vnd.card+source`, `application/vnd.api+json`, `text/event-stream`, `text/html`) and the HTTP verb (`GET`, `PATCH`, `POST`, `DELETE` ), it will perform one of the actions listed in the above list. The routing that depends on the MIME type and HTTP method is defined in `router.ts`. There's a special case of requesting the realm root (`/`) with `GET` and `application/vnd.card+json`. This looks for a card instance at `index.json` to return.

The different types of requests, together with its params, are documented in `realm-server-test.ts`.

## Transpiling code

The realm also has an internal capability to transpile card code using Babel transforms. `handle` function has an option to
respond with a Glimmer template (.gts file) which is compiled to JavaScript. This is useful for browsers to be able to
actually execute the card code.

## Types of realms

The realm is isomorphic JavaScript code meant to be run in any environment, and there exists a RealmAdapter whose job is to provide environment specific implementations for 2 different types of realms.

### Hosted realm

This realm runs in a Node.js environment on a server.

### DOM realm

This is a realm that is used in the tests.

## Future capabilities

We are planning to introduce a set of permissions that a realm can enforce against the cards it contains. The permissions will not be card specific but they will apply to all cards in the realm, which implies the idea of identity that will be supported by realms.
