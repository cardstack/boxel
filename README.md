# Boxel Runtime

## Setup

- you will want the [Glint](https://marketplace.visualstudio.com/items?itemName=typed-ember.glint-vscode) vscode extension
- this project uses [pnpm](https://pnpm.io/) for package management. run `pnpm install` to install the project dependencies first.

## Orientation

`packages/host` is the card runtime host application

`packages/worker` is a separate build for the service worker that serves a realm

`packages/realm-server` is a node app that serves the realm as an HTTP server, as well as, it can also host the runtime application for its own realm and optionally the local-realm.

`packages/boxel-motion` is the animation primitives ember addon.

`packages/boxel-motion-test-app` is the test suite for boxel-motion

`packages/boxel-motion-demo-app` is the demo app for boxel-motion

## Running the Host App

There exists a "dev" mode in which we can use ember-cli to host the card runtime host application which includes live reloads. Additionally, you can also use the realm server to host the app. 

### ember-cli Hosted App
In order to run the ember-cli hosted app:

1. `pnpm start` in the worker/ workspace to build the service worker (you can omit this step if you do not want service worker re-builds)
2. `pnpm start` in the host/ workspace to serve the ember app. Note that this script includes the environment variable `REALM_BASED_HOSTING_DISABLED=true` which enables this type of build for the host app.
3. `pnpm start:base` in the realm-server/ to serve the base realm (alternatively you can use `pnpm start:all` which also serves the base realm--this is convenient if you wish to switch between the app and the tests without having to restart servers)

The app is available at http://localhost:4200. Click on the button to connect to your Local Realm, and then select the "cards/" folder within this project. Click "Allow" on the popups that ask for the ability to read and write to the local file system.

> Note that the ember build for the ember-cli hosted app is not compatible with a realm server hosted model. If you wish to visit a realm server URL directly to view its app then you must use the "Realm server Hosted App" instructions described in the following section.
### Realm server Hosted App
In order to run the realm server hosted app:

1. `pnpm start` in the worker/ workspace to build the service worker (you can omit this step if you do not want service worker re-builds).
2. `pnpm start:build` in the host/ workspace to re-build the host app (this step can be omitted if you do not want host app re-builds)
3. `pnpm start:base` in the realm-server/ to serve the base realm (alternatively you can use `pnpm start:all` which also serves the base realm--this is convenient if you wish to switch between the app and the tests without having to restart servers)

You can visit the URL of each realm server to view that realm's app. So for instance, the base realm's app is available at `http://localhost:4201/base`. Additionally, we have enabled the server that hosts the base realm to also be able to host the local-realm app. To use the local realm visit: `http://localhost:4201/local`.

Live reloads are not available in this mode, but you can just refresh the page to grab the latest code changes if you are running rebuilds (step #1 and #2 above).

### Card Pre-rendering

In order to support server-side rendered cards, this project incorporates FastBoot. By default `pnpm start` in the `packages/host` workspace will serve server-side rendered cards. Specifically, the route `/render?url=card_url&format=isolated` will serve pre-rendered cards. There is additional build overhead required to serve pre-rendered cards. If you are not working on the `/render` route in the host, then you would likely benefit from disabling FastBoot when starting up the host server so that you can have faster rebuilds. To do so, you can start the host server using:
`FASTBOOT_DISABLED=true pnpm start`.

The realm server also uses FastBoot to pre-render card html. The realm server boots up the host app in a FastBoot container. The realm server will automatically look for the host app's `dist/` output to use when booting up the infrastructure for pre-rendering cards. Make sure to start to the host app first before starting the realm server so that the host app's `dist/` output will be generated. If you are making changes that effect the `/render` route in the host app, you'll want to restart the host app (or run `pnpm build`) in order for the realm server to pick up your changes.

## Boxel Motion Demo App

In order to run the boxel-motion demo app:

1. `cd to packages/boxel-motion-demo-app`
2. `pnpm start`
3. visit http://localhost:4200 in your browser

## Running the Tests

There are currently 4 test suites:

### Host

To run the `packages/host/` workspace tests start the following servers: 2. `pnpm start:all` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards 3. `pnpm start:tests` in the `packages/host/` workspace to serve ember

The tests are available at `http://localhost:7357`

Note that the host app uses a wildcard route to take over all the routes, so the standard `http://localhost:4200/tests` won't actually run the tests

### Realm Server

First make sure to generate the host app's `dist/` output in order to support card pre-rendering by first starting the host app (instructions above). If you want to make the host app's `dist/` output without starting the host app, you can run `pnpm build` in the host app's workspace.

To run the `packages/realm-server/` workspace tests start:

1. `pnpm start:all` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards for node.

Run `pnpm test` in the `packages/realm-server/` workspace to run the realm tests

### Realm Server DOM tests
This test suite contains acceptance tests for asserting that the Realm server is capable of hosting its own app. These tests require that the host be built with the ability to support realm based hosting. To run these tests in the browser execute the following in the `packages/realm-server` workspace:

1. `pnpm start:test-container`
2. `pnpm start:all`

Visit `http://localhost:5000` after the realms have finished starting up

### Boxel Motion

1. `cd packages/boxel-motion-test-app`
2. `pnpm test` (or `pnpm start` and visit http://localhost:4200/tests to run tests in the browser)
