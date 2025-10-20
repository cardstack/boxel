# @cardstack/host

This README outlines the details of collaborating on this Ember application.
A short introduction of this app could easily go here.

## Prerequisites

You will need the following things properly installed on your computer.

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) (with npm)
- [Ember CLI](https://cli.emberjs.com/release/)
- [Google Chrome](https://google.com/chrome/)

## Installation

- clone the monorepo and `pnpm install`

## Running / Development

- `ember serve`
- Visit your app at [http://localhost:4200](http://localhost:4200).
- Visit your tests at [http://localhost:4200/tests](http://localhost:4200/tests).

### Updating the default SystemCard to add new LLMs

The default model card is defined in the catalog realm, in SystemCard/default.json.

This has a list of "ModelConfiguration" cards that define the LLMs available to the system.

When adding a new LLM, you will need to create a new ModelConfiguration card in the catalog realm's ModelConfiguration directory,
and then add that card's ID to the SystemCard/default.json file.

Users can use a system card of their choice, so you can test a new model out creating a new system card that references your new model configuration. Use the three dot menu on a system card to set it as your default system card.

### Code Generators

Make use of the many generators for code, try `ember help generate` for more details

### Running Tests

- `pnpm test`
- `pnpm test --server`

### Linting

- `pnpm run lint`
- `pnpm run lint:fix`

### Building

- `pnpm build` (development)
- `pnpm build:production` (production)

### Deploying

Specify what it takes to deploy your app.

## Further Reading / Useful Links

- [ember.js](https://emberjs.com/)
- [ember-cli](https://cli.emberjs.com/release/)
- Development Browser Extensions
  - [ember inspector for chrome](https://chrome.google.com/webstore/detail/ember-inspector/bmdblncegkenkacieihfhpjfppoconhi)
  - [ember inspector for firefox](https://addons.mozilla.org/en-US/firefox/addon/ember-inspector/)
