# Boxel Runtime

## Setup

- you will want the [Glint](https://marketplace.visualstudio.com/items?itemName=typed-ember.glint-vscode) vscode extension
- this project uses [pnpm](https://pnpm.io/) for package management. run `pnpm install` to install the project dependencies first.

## Orientation

`packages/host` is the card runtime host application

`packages/worker` is a separate build for the service worker that serves a realm

`packages/realm-server` is a node app that serves the realm as an HTTP server

`packages/boxel-motion` is the animation primitives ember addon.

`packages/boxel-motion-test-app` is the test suite for boxel-motion

`packages/boxel-motion-demo-app` is the demo app for boxel-motion

## Running the App

In order to run app

1. `pnpm start` in the worker/ workspace to build the service worker
2. `pnpm start` in the host/ workspace to serve the ember app
3. `pnpm start:base` in the realm-server/ to serve the base realm (alternatively you can use `pnpm start:test-realms` which also serves the base realm--this is convenient if you wish to switch between the app and the tests without having to restart servers)

The app is available at http://localhost:4200. Click on the button to connect to your Local Realm, and then select the "cards/" folder within this project. Click "Allow" on the popups that ask for the ability to read and write to the local file sytem.

## Running the Tests

There are currently 3 test suites:

### Host

To run the `packages/host/` workspace tests start the following servers: 2. `pnpm start:test-realms` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards 3. `pnpm start` in the `packages/host/` workspace to serve ember

The tests are available at `http://localhost:4200/tests`

### Realm Server

To run the `packages/realm-server/` workspace tests start:

1. `pnpm start:test-realms` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards for node.

Run `pnpm test` in the `packages/realm-server/` workspace to run the realm tests

### Boxel Motion

`cd packages/boxel-motion-test-app`
`pnpm test`
