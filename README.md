# Boxel Runtime

## Setup

- you will want the [Glint](https://marketplace.visualstudio.com/items?itemName=typed-ember.glint-vscode) vscode extension
- you will want the [vscode-glimmer](https://marketplace.visualstudio.com/items?itemName=chiragpat.vscode-glimmer) vscode extension
- you will want the [Playwright](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) vscode extension
- this project uses [pnpm](https://pnpm.io/) for package management. run `pnpm install` to install the project dependencies first.
- this project uses [docker](https://docker.com). Make sure to install docker on your system.

## Orientation

`packages/host` is the card runtime host application

`packages/worker` is a separate build for the service worker that serves a realm

`packages/realm-server` is a node app that serves the realm as an HTTP server, as well as, it can also host the runtime application for its own realm and optionally the local-realm.

`packages/boxel-motion` is the animation primitives ember addon.

`packages/boxel-motion-test-app` is the test suite for boxel-motion

`packages/boxel-motion-demo-app` is the demo app for boxel-motion

`packages/matrix` ***TODO***

## Running the Host App

There exists a "dev" mode in which we can use ember-cli to host the card runtime host application which includes live reloads. Additionally, you can also use the realm server to host the app. 

### ember-cli Hosted App
In order to run the ember-cli hosted app:

1. `pnpm start` in the worker/ workspace to build the service worker (you can omit this step if you do not want service worker re-builds)
2. `pnpm start` in the host/ workspace to serve the ember app. Note that this script includes the environment variable `REALM_BASED_HOSTING_DISABLED=true` which enables this type of build for the host app.
3. `pnpm start:base` in the realm-server/ to serve the base realm (alternatively you can use `pnpm start:all` which also serves the base realm--this is convenient if you wish to switch between the app and the tests without having to restart servers)
4. `pnpm start:synapse` in the matrix/ workspace to run the matrix server.

The app is available at http://localhost:4200. Click on the button to connect to your Local Realm, and then select the "packages/demo-cards" folder within this project. Click "Allow" on the popups that ask for the ability to read and write to the local file system.

When you are done running the app you can stop the synapse server by running the following from the `packages/matrix` workspace:
```
pnpm stop:synapse
```

### Realm server Hosted App
In order to run the realm server hosted app:

1. `pnpm start` in the worker/ workspace to build the service worker (you can omit this step if you do not want service worker re-builds).
2. `pnpm start:build` in the host/ workspace to re-build the host app (this step can be omitted if you do not want host app re-builds)
3. `pnpm start:base` in the realm-server/ to serve the base realm
4. `pnpm start:synapse` in the matrix/ workspace to run the matrix server.

You can visit the URL of each realm server to view that realm's app. So for instance, the base realm's app is available at `http://localhost:4201/base`. Additionally, we have enabled the server that hosts the base realm to also be able to host the local-realm app. To use the local realm visit: `http://localhost:4201/local`.

Live reloads are not available in this mode, but you can just refresh the page to grab the latest code changes if you are running rebuilds (step #1 and #2 above).

#### Using `start:all`

Instead of running `start:base`, you can alternatively use `pnpm start:all` which also serves a few other realms on other ports--this is convenient if you wish to switch between the app and the tests without having to restart servers. Here's what is spun up with `start:all`:

| Port | What runs there with `start:all`                      |
| ---- | ------------------------------------------------------|
|:4201 | `/base` base realm, `/local` local realm              |
|:4202 | `/test` host test realm, `/node-test` node test realm |
|:4203 | `root (/)` base realm                                 |
|:4204 | `root (/)` demo realm                                 |
|:4205 | qunit server mounting realms in iframes for testing   |

### Card Pre-rendering

In order to support server-side rendered cards, this project incorporates FastBoot. By default `pnpm start` in the `packages/host` workspace will serve server-side rendered cards. Specifically, the route `/render?url=card_url&format=isolated` will serve pre-rendered cards. There is additional build overhead required to serve pre-rendered cards. If you are not working on the `/render` route in the host, then you would likely benefit from disabling FastBoot when starting up the host server so that you can have faster rebuilds. To do so, you can start the host server using:
`FASTBOOT_DISABLED=true pnpm start`.

The realm server also uses FastBoot to pre-render card html. The realm server boots up the host app in a FastBoot container. The realm server will automatically look for the host app's `dist/` output to use when booting up the infrastructure for pre-rendering cards. Make sure to start to the host app first before starting the realm server so that the host app's `dist/` output will be generated. If you are making changes that effect the `/render` route in the host app, you'll want to restart the host app (or run `pnpm build`) in order for the realm server to pick up your changes.

### Matrix Server
The boxel platform leverages a Matrix server called Synapse in order to support identity, workflow, and chat behaviors. This project uses a dockerized Matrix server. We have multiple matrix server configurations (currently one for development that uses a persistent DB, and one for testing that uses an in-memory DB). You can find and configure these matrix servers at `packages/matrix/docker/synapse/*`. 

To start the matrix server, from `packages/matrix`, execute:
```
pnpm start:synapse
```
The local Matrix server will be running at `http://localhost:8008`.

To stop the matrix server, from `packages/matrix`, execute:
```
pnpm stop:synapse
```

#### Matrix Administration

Matrix administration requires an administrative user and a special client in order to use. Matrix administration is used for creating users, creating rooms, creating registration tokens, managing media, viewing events, etc.

First you must create an administrative user:
1. start the matrix server `pnpm start:synapse`
2. run a script to create an administrative user:
   ```
   docker exec -it boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u admin -p your_admin_password --admin
   ```

After you have created an administrative user you can start the admin console by executing the following in the packages/matrix workspace:
```
pnpm start:admin
```

Then visit `http://localhost:8080`, and enter the admin user's username (`admin`) and the password, also enter in your matrix server url `http://localhost:8008` in the homeserver URL field, and click "Signin".

Note you can use this same administrative interface to login to the staging and production matrix server. The credentials are available in AWS secrets manager.

To stop the admin console run the following in the packages/matrix workspace:
```
pnpm stop:admin
```

## Boxel UI Component Explorer

There is a ember-freestyle component explorer available to assist with development. In order to run the freestyle app:

1. `cd packages/boxel-ui`
2. `pnpm start`
3. Visit http://localhost:4210/ in your browser

## Boxel Motion Demo App

In order to run the boxel-motion demo app:

1. `cd packages/boxel-motion-demo-app`
2. `pnpm start`
3. Visit http://localhost:4200 in your browser

## Running the Tests

There are currently 5 test suites:

### Host

To run the `packages/host/` workspace tests start the following servers: 2. `pnpm start:all` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards 3. `pnpm start` in the `packages/host/` workspace to serve ember

The tests are available at `http://localhost:4200/tests`


### Realm Server Node tests

First make sure to generate the host app's `dist/` output in order to support card pre-rendering by first starting the host app (instructions above). If you want to make the host app's `dist/` output without starting the host app, you can run `pnpm build` in the host app's workspace.

To run the `packages/realm-server/` workspace tests start:

1. `pnpm start:all` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards for node.

Run `pnpm test` in the `packages/realm-server/` workspace to run the realm node tests

### Realm Server DOM tests
This test suite contains acceptance tests for asserting that the Realm server is capable of hosting its own app. To run these tests in the browser execute the following in the `packages/realm-server` workspace:

1. `pnpm start:all`

Visit `http://localhost:4205` after the realms have finished starting up

### Boxel Motion

1. `cd packages/boxel-motion-test-app`
2. `pnpm test` (or `pnpm start` and visit http://localhost:4200/tests to run tests in the browser)

### Matrix tests
This test suite contains tests that exercise matrix functionality. These tests are located at `packages/matrix/tests`, and are executed using the [Playwright](https://playwright.dev/) test runner. To run the tests from the command line, first make sure that the matrix server is not already running. You can stop the matrix server by executing the following from `packages/matrix`
```
pnpm stop:synapse
```

Then to run the tests from the CLI execute the following from `packages/matrix`:
```
pnpm start:test
``` 

Alternatively you can also run these tests from VS Code using the VS Code Playwright plugin (which is very strongly recommended). From the "test tube" icon, you can click on the play button to run a single test or all the tests. 

![Screenshot_20230427_161250](https://user-images.githubusercontent.com/61075/234980198-fe049b61-917d-4dc8-a9eb-ddc54b36b160.png)

or click on the play button in the left margin next to the test itself to run a test:
![Screenshot_20230428_150147](https://user-images.githubusercontent.com/61075/235231663-6fabfc41-8294-4674-adf1-f3793b83e516.png)

you can additionally set a breakpoint in code, and playwright will break at the breakpoint. 