# Rough work-in-progress

## Setup

- you will want the [Glint](https://marketplace.visualstudio.com/items?itemName=typed-ember.glint-vscode) vscode extension

## Orientation

`host` is the ember app

`worker` is a separate build for the service worker

The top-level of the monorepo contains typescript & glint setting for the ember app, because Glint doesn't like monorepos.

## Running the App
In order to run app (as well as tests):
1. `yarn start` in the worker/ workspace to build the service worker
2. `yarn start` in the host/ workspace to serve the ember app
3. `yarn start:base` in the realm-server/ to serve the base realm
