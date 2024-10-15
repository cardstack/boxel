# @cardstack/boxel-icons

Provides components for all the Lucide icons.

## Preview

The [BoxelUI preview app](https://boxel-ui.stack.cards) contains a preview of all the icons (see "Boxel-Icons in left nav").

## Project Orientation

`pnpm rebuild:all` generates one gts file per icon using the lucide-icons package as its source. These get commited to git, so you only need to run it when updating.

`pnpm build` compiles the gts files to JS and produces typescript declaration files. The components are compiled all the way to wire format so they're directly loadable by @cardstack/host.

`pnpm deploy:s3` synchronizes the built code to an S3 bucket where they're served at https://boxel-icons.boxel.ai (via CloudFront).

## Local Development

`pnpm serve` in this directory starts a local webserver. You can point `host` at it by setting ICONS_URL=http://localhost:4206.
