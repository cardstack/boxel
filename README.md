# Rough work-in-progress

## Setup

- you will want the [Glint](https://marketplace.visualstudio.com/items?itemName=typed-ember.glint-vscode) vscode extension

## Orientation

`host` is the ember app

`worker` is a separate build for the service worker

The top-level of the monorepo contains typescript & glint setting for the ember app, because Glint doesn't like monorepos.

## Running the App
In order to run app
1. `yarn start` in the worker/ workspace to build the service worker
2. `yarn start` in the host/ workspace to serve the ember app
3. `yarn start:base` in the realm-server/ to serve the base realm

## Running the Tests
There are currently 2 test suites: the host/ workspace tests and the realm-server/ workspace tests.

### Host
To run the  `host/`  workspace tests start the following servers:
1. `yarn start:base` in the `realm-server/` to serve the base realm
2. `yarn start:test-realm` in the `realm-server/` to serve the realm that emulates the worker
3. `yarn start` in the `host/` workspace to serve ember

The tests are available at `http://localhost:4200/tests`

### Realm Server
To run the `realm-server/` workspace tests start:
1. `yarn start:base` in the `realm-server/` workspace to serve the base realm

Run `yarn test` in the `realm-server/` workspace to run the realm tests
