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

The entry point that serves these requests `handle` function in `realm.ts` file. Depending on the `Accept` header
(the recognized ones are `application/vnd.api+json`, `text/event-stream`, `application/vnd.card+source`, `text/html`)
and the HTTP verb (`GET`, `PATCH`, `POST`, `DELETE` ), it will perform one of the actions listed in the above list.

The different types of requests, together with its params, are documented in `realm-server-test.ts`.

## Transpiling code

The realm also has an internal capability to transpile card code using Babel transforms. `handle` function has an option to
respond with a Glimmer template (.gts file) which is compiled to JavaScript. This is useful for browsers to be able to
actually execute the card code.

## Types of realms

There are 3 types of realms.

### Hosted realm

This realm runs in a Node.js environment on a server.

### Local realm

Runs locally, in the user's browser. This enables card authors to write and run cards on their computer.
There is a service worker included which runs the realm code, and all requests described above are served from the realm hosted
in the service worker. Service worker acts as an intermediary between the browser and the local filesystem, and hosts the realm
together with the locally indexed card data.

### DOM realm

This is a realm that is used in the tests.
