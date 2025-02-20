# Boxel Runtime

For a quickstart, see [here](./QUICKSTART.md)

## Setup

- you will want the [Glint](https://marketplace.visualstudio.com/items?itemName=typed-ember.glint-vscode) vscode extension
- you will want the [vscode-glimmer](https://marketplace.visualstudio.com/items?itemName=chiragpat.vscode-glimmer) vscode extension
- you will want the [Playwright](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) vscode extension
- this project uses [volta](https://volta.sh/) for Javascript toolchain version management. Make sure you have the latest verison of volta on your system and have define [the ENV var described here](https://docs.volta.sh/advanced/pnpm).
- this project uses [pnpm](https://pnpm.io/) for package management. run `pnpm install` to install the project dependencies first.
- this project uses [docker](https://docker.com). Make sure to install docker on your system.
- Ensure that node_modules/.bin is in your path. e.g. include `export PATH="./node_modules/.bin:$PATH"` in your .zshrc

## Orientation

`packages/host` is the card runtime host application

`packages/realm-server` is a node app that serves the realm as an HTTP server, as well as, it can also host the runtime application for its own realm.

`packages/boxel-ui/addon` is the UI components Ember addon

`packages/boxel-ui/test-app` is the test suite and component explorer for boxel-ui, deployed at [boxel-ui.stack.cards](https://boxel-ui.stack.cards)

`packages/boxel-motion/addon` is the animation primitives ember addon.

`packages/boxel-motion/test-app` is the demo app for boxel-motion, deployed at [boxel-motion.stack.cards](https://boxel-motion.stack.cards)

`packages/matrix` is the docker container for running the matrix server: synapse, as well as tests that involve running a matrix client.

`packages/ai-bot` is a node app that runs a matrix client session and an OpenAI session. Matrix message queries sent to the AI bot are packaged with an OpenAI system prompt and operator mode context and sent to OpenAI. The ai bot enriches the OpenAI response and posts the response back into the matrix room.

`packages/vscode-boxel-tools` is a VS Code extension for browsing Boxel workspaces, published as [Boxel Tools](https://marketplace.visualstudio.com/items?itemName=cardstack.boxel-tools). It can be deployed via the bot, with `staging` environment producing a pre-release version.

To learn more about Boxel and Cards, see our [documentation](./docs/README.md)

## Running the Host App

There exists a "dev" mode in which we can use ember-cli to host the card runtime host application which includes live reloads. Additionally, you can also use the realm server to host the app, which is how it will be served in production.

### ember-cli Hosted App

Prerequisite:
Make sure that you have created a matrix user for the base and experiments realms. To make it easier, you can execute `pnpm register-realm-users` in `packages/matrix/`, this will create a matrix user for the base and experiments realms.

In order to run the ember-cli hosted app:

1. `pnpm build` in the boxel-ui/addon workspace to build the boxel-ui addon.
2. `pnpm build` in the boxel-motion/addon workspace to build the boxel-motion addon.
3. `pnpm start` in the host/ workspace to serve the ember app.
4. `pnpm start:all` in the realm-server/ to serve the base and experiments realms -- this will also allow you to switch between the app and the tests without having to restart servers). This expects the Ember application to be running at `http://localhost:4200`, if you’re running it elsewhere you can specify it with `HOST_URL=http://localhost:5200 pnpm start:all`.

The app is available at http://localhost:4200. You will be prompted to register an account. To make it easier, you can execute `pnpm register-test-user` in `packages/matrix/`. Now you can sign in with the test user using the credentials `username: user`, `password: password`.

When you are done running the app you can stop the synapse server by running the following from the `packages/matrix` workspace:

```
pnpm stop:synapse
```

### Realm server Hosted App

In order to run the realm server hosted app:

1. `pnpm start:build` in the host/ workspace to re-build the host app (this step can be omitted if you do not want host app re-builds)
2. `pnpm start:all` in the realm-server/ to serve the base and experiments realms

You can visit the URL of each realm server to view that realm's app. So for instance, the base realm's app is available at `http://localhost:4201/base` and the experiments realm's app is at `http://localhost:4201/experiments`.

Live reloads are not available in this mode, however, if you use start the server with the environment variable `DISABLE_MODULE_CACHING=true` you can just refresh the page to grab the latest code changes if you are running rebuilds (step #1 and #2 above).

#### Using `start:all`

Instead of running `pnpm start:base`, you can alternatively use `pnpm start:all` which also serves a few other realms on other ports--this is convenient if you wish to switch between the app and the tests without having to restart servers. Use the environment variable `WORKER_HIGH_PRIORITY_COUNT` to add additional workers that service only user initiated requests and `WORKER_ALL_PRIORITY_COUNT` to add workers that service all jobs (system or user initiated). By default there is 1 all priority worker for each realm server. Here's what is spun up with `start:all`:

| Port  | Description                                                   | Running `start:all` | Running `start:base` |
| ----- | ------------------------------------------------------------- | ------------------- | -------------------- |
| :4201 | `/base` base realm                                            | ✅                  | ✅                   |
| :4201 | `/experiments` experiments realm                              | ✅                  | 🚫                   |
| :4201 | `/seed` seed realm                                            | ✅                  | 🚫                   |
| :4202 | `/test` host test realm, `/node-test` node test realm         | ✅                  | 🚫                   |
| :4205 | `/test` realm for matrix client tests (playwright controlled) | 🚫                  | 🚫                   |
| :4210 | Development Worker Manager (spins up 1 worker by default)     | ✅                  | 🚫                   |
| :4211 | Test Worker Manager (spins up 1 worker by default)            | ✅                  | 🚫                   |
| :4212 | Worker Manager for matrix client tests (playwright controlled - 1 worker) | ✅      | 🚫                   |
| :4213 | Worker Manager for matrix client tests - base realm server (playwright controlled - 1 worker) | ✅ | 🚫    |
| :5001 | Mail user interface for viewing emails sent to local SMTP     | ✅                  | 🚫                   |
| :5435 | Postgres DB                                                   | ✅                  | 🚫                   |
| :8008 | Matrix synapse server                                         | ✅                  | 🚫                   |

#### Using `start:development`

You can also use `start:development` if you want the functionality of `start:all`, but without running the test realms. `start:development` will enable you to open http://localhost:4201 and allow to select between the cards in the /base and /experiments realm. In order to use `start:development` you must also make sure to run `start:worker-development` in order to start the workers (which are normally started in `start:all`.

### Card Pre-rendering

In order to support server-side rendered cards, this project incorporates FastBoot. By default `pnpm start` in the `packages/host` workspace will serve server-side rendered cards. Specifically, the route `/render?url=card_url&format=isolated` will serve pre-rendered cards. There is additional build overhead required to serve pre-rendered cards. If you are not working on the `/render` route in the host, then you would likely benefit from disabling FastBoot when starting up the host server so that you can have faster rebuilds. To do so, you can start the host server using:
`FASTBOOT_DISABLED=true pnpm start`.

The realm server also uses FastBoot to pre-render card html. The realm server boots up the host app in a FastBoot container. The realm server will automatically look for the host app's `dist/` output to use when booting up the infrastructure for pre-rendering cards. Make sure to start to the host app first before starting the realm server so that the host app's `dist/` output will be generated. If you are making changes that effect the `/render` route in the host app, you'll want to restart the host app (or run `pnpm build`) in order for the realm server to pick up your changes.

### Request Accept Header

The realm server uses the request accept header to determine the type of request being made and in what format it should return the content.

| Accept Header                 | URL rules                                                                                                                                                                                                                                                                                                            | Description                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `application/vnd.card+json`   | If card instance URL includes the `.json` extension, the server will redirect to the URL without the extension.                                                                                                                                                                                                      | Used to request card instances for normal consumption                                                                                                                          |
| `application/vnd.card+source` | For code modules we support node-like resolution, which means that the extension is optional. If the extension is not provided the server will redirect to the URL with the extension. We also support card instance requests without the `.json` extension. The server will redirect to the URL with the extension. | Used to request source file format for code modules or card instances (note that card instances are returned using file serialization which notably contains no `id` property) |
| `application/vnd.api+json`    | Directory listing requests need to have their URL's end with a `/` character                                                                                                                                                                                                                                         | Used to request a directory listing or to get realm info                                                                                                                       |
| `text/event-stream`           | only `<REALM_URL>/_messages` is supported                                                                                                                                                                                                                                                                            | Used to subscribe to realm events via Server Sent Events                                                                                                                       |
| `text/html`                   | Card instance URL's should not include the `.json` file extension. This is considered a 404                                                                                                                                                                                                                          | Used to request rendered card instance html (this serves the host application)                                                                                                 |
| `*/*`                         | We support node-like resolution, which means that the extension is optional                                                                                                                                                                                                                                          | Used to request transpiled executable code modules                                                                                                                             |

### Database

Boxel uses a Postgres database. In development, the Postgres database runs within a docker container, `boxel-pg`, that is started as part of `pnpm start:all`. You can manually start and stop the `boxel-pg` docker container using `pnpm start:pg` and `pnpm stop:pg`. The postgres database runs on port 5435 so that it doesn't conflict with a natively installed postgres that may be running on your system.

When running tests we isolate the database between each test run by actually creating a new database for each test with a random database name (e.g. `test_db_1234567`). The test databases are dropped before the beginning of each test run.

If you wish to drop the development databases you can execute:

```
pnpm full-reset
```

You can then run `pnpm migrate up` (with `PGDATABASE` set accordingly if you want to migrate a database other than `boxel`) or just start the realm server (`pnpm start:all`) to create the database again.

To interact with your local database directly you can use psql:

```
psql -h localhost -p 5435 -U postgres
```

#### DB Migrations

When the realm server starts up it will automatically run DB migrations that live in the `packages/realm-server/migrations` folder. As part of development you may wish to run migrations manually as well as to create a new migration.

To create a new migration, from `packages/postgres`, execute:

```
pnpm migrate create name-of-migration
```

This creates a new migration file in `packages/postgres/migrations`. You can then edit the newly created migration file with the details of your migration. We use `node-pg-migrate` to handle our migrations. You can find the API at https://salsita.github.io/node-pg-migrate.

To run the migration, execute:

```
pnpm migrate up
```

To revert the migration, execute:

```
pnpm migrate down
```

Boxel also uses SQLite in order to run the DB in the browser as part of running browser tests (and eventually we may run the realm server in the browser to provide a local index). We treat the Postgres database schema as the source of truth and derive the SQLite schema from it. Therefore, once you author and apply a migration, you should generate a new schema SQL file for SQLite. To generate a new SQLite schema, from `packages/postgres`, execute:

```
pnpm make-schema
```

This will create a new SQLite schema based on the current postgres DB (the schema file will be placed in the `packages/host/config/schema` directory). This schema file will share the same timestamp as the latest migration file's timestamp. If you forget to generate a new schema file, the next time you start the host app, you will receive an error that the SQLite schema is out of date.

### Matrix Server

The boxel platform leverages a Matrix server called Synapse in order to support identity, workflow, and chat behaviors. This project uses a dockerized Matrix server. We have multiple matrix server configurations (currently one for development that uses a persistent DB, and one for testing that uses an in-memory DB). You can find and configure these matrix servers at `packages/matrix/docker/synapse/*`.

This server is automatically started as part of the `pnpm start:all` script, but if you wish to control it separately, from `packages/matrix`, execute:

```
pnpm start:synapse
```

The local Matrix server will be running at `http://localhost:8008`.

To stop the matrix server, from `packages/matrix`, execute:

```
pnpm stop:synapse
```

#### Matrix Administration

Matrix administration requires an administrative user and a special client in order to use. Matrix administration is used for creating users, creating rooms, creating registration tokens, managing media, viewing events, etc. Note that you will need to use the matrix administration UI to create tokens to register new matrix users or you can execute `pnpm register-test-token` and use the token `dev-token`.

First you must create an administrative user:

1. start the matrix server `pnpm start:synapse`
2. run a script to create an administrative user:
   ```
   docker exec -it boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u admin -p your_admin_password --admin
   ```
   Alternatively, you can execute `pnpm register-test-admin` and utilize the following credentials: `user: admin` and `password: password`.

After you have created an administrative user and can start the admin console by executing the following in the packages/matrix workspace:

```
pnpm start:admin
```

Then visit `http://localhost:8080`, and enter the admin user's username (`admin`) and the password, also enter in your matrix server url `http://localhost:8008` in the homeserver URL field, and click "Signin".

Note you can use this same administrative interface to login to the staging and production matrix server. The credentials are available in AWS SSM Parameter Store.

To stop the admin console run the following in the packages/matrix workspace:

```
pnpm stop:admin
```

#### SMTP Server

Matrix requires an SMTP server in order to send emails. In order to facilitate this we leverage [smtp4dev](https://github.com/rnwood/smtp4dev) in dev and test (CI) environments . This is a docker container that includes both a local SMTP server and hosts a web app for viewing all emails send from the SMTP server (the emails never leave the docker container). smtp4dev runs in the same docker network as synapse, so the SMTP port is never projected to the docker host. smtp4dev also runs the web app used to view emails sent from the SMTP server at `http://localhost:5001`. You can open a browser tab with this URL to view any emails sent from the matrix server. As well as, our matrix tests leverage the mail web app in order to perform email assertions. smtp4dev is automatically started as part of running `pnpm start:all` in the `packages/realm-server` workspace.

## Boxel UI Component Explorer

There is a ember-freestyle component explorer available to assist with development. In order to run the freestyle app:

1. `cd packages/boxel-ui/test-app`
2. `pnpm start`
3. Visit http://localhost:4220/ in your browser

## Boxel Motion Demo App

In order to run the boxel-motion demo app:

1. `cd packages/boxel-motion/test-app`
2. `pnpm start`
3. Visit http://localhost:4200 in your browser

## Payment Setup

There is some pre-setup needed to enable free plan on development account:

1. Go to `packages/realm-server` and run stripe script to listen for the webhooks that Stripe sends to the realm server

```
pnpm stripe listen --forward-to host.docker.internal:4201/_stripe-webhook --api-key sk_test_api_key_from_the_sandbox_account
```

2. You will get webhook signing secret from stripe cli after Step 1 is done

```
> Ready! You are using Stripe API Version [x]. Your webhook signing secret is whsec_xxxxx
```

3. Go to `packages/realm-server` and run the following command to sync the stripe products to the database, make sure you have the stripe api key set. You only need to run this once OR if you want to sync the products again.

```
STRIPE_API_KEY=... pnpm sync-stripe-products
```

4. Go to `packages/realm-server`, pass STRIPE_WEBHOOK_SECRET & STRIPE_API_KEY environment value and start the realm server. STRIPE_WEBHOOK_SECRET is the value you got from stripe cli in Step 2.

```
STRIPE_WEBHOOK_SECRET=... STRIPE_API_KEY=... pnpm start:all
```

5. Perform "Setup up Secure Payment Method" flow. Subscribe with valid test card [here](https://docs.stripe.com/testing#cards)

You should be able to subscribe successfully after you perform the steps above.

## Running the Tests

There are currently 5 test suites:

### Host

To run the `packages/host/` workspace tests start the following servers:

1. `pnpm start:all` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards
2. `pnpm start` in the `packages/host/` workspace to serve ember

The tests are available at `http://localhost:4200/tests`

### Realm Server Node tests

First make sure to generate the host app's `dist/` output in order to support card pre-rendering by first starting the host app (instructions above). If you want to make the host app's `dist/` output without starting the host app, you can run `pnpm build` in the host app's workspace.

To run the `packages/realm-server/` workspace tests start:

1. `pnpm start:all` in the `packages/realm-server/` to serve _both_ the base realm and the realm that serves the test cards for node.
2. Run `pnpm test` in the `packages/realm-server/` workspace to run the realm node tests. `TEST_MODULE=realm-endpoints-test.ts pnpm test-module` is an example of how to run a single test module.

### Boxel UI

1. `cd packages/boxel-ui/test-app`
2. `pnpm test` (or `pnpm start` and visit http://localhost:4220/tests to run tests in the browser)

### Boxel Motion

1. `cd packages/boxel-motion-test-app`
2. `pnpm test` (or `pnpm start` and visit http://localhost:4200/tests to run tests in the browser)

### Matrix tests

This test suite contains tests that exercise matrix functionality. These tests are located at `packages/matrix/tests`, and are executed using the [Playwright](https://playwright.dev/) test runner. To run the tests from the command line, first make sure that the matrix server is not already running. You can stop the matrix server by executing the following from `packages/matrix`

```
pnpm stop:synapse
```

The matrix client relies upon the host app and the realm servers. Start the host app from the `packages/host` folder:

```
pnpm start
```

Then start the realm server for matrix tests (does not start the matrix server). From the `packages/realm-server` folder:

```
MATRIX_REGISTRATION_SHARED_SECRET='xxxx' pnpm start:services-for-matrix-tests
```

Then to run the tests from the CLI execute the following from `packages/matrix`:

```
pnpm test
```

Alternatively you can also run these tests from VS Code using the VS Code Playwright plugin (which is very strongly recommended). From the "test tube" icon, you can click on the play button to run a single test or all the tests.

![Screenshot_20230427_161250](https://user-images.githubusercontent.com/61075/234980198-fe049b61-917d-4dc8-a9eb-ddc54b36b160.png)

or click on the play button in the left margin next to the test itself to run a test:
![Screenshot_20230428_150147](https://user-images.githubusercontent.com/61075/235231663-6fabfc41-8294-4674-adf1-f3793b83e516.png)

you can additionally set a breakpoint in code, and playwright will break at the breakpoint.
