---
name: catalog-deploy
description: How a boxel-catalog change reaches staging and production, and how to deploy the catalog to production — every catalog merge syncs staging; production gets the catalog only from boxel-catalog's "Deploy catalog to production" workflow, started either by hand (to ship catalog work ahead of boxel) or by Manual Deploy [boxel] to production (which deploys the catalog revision the deployed boxel pins, once before its release and once after). Covers what the deploy checks before it changes anything (catalog pull requests that declare `Merges after:` a boxel pull request production doesn't run yet), how to read its refusal and its "nothing to do" skip, how to find which boxel and catalog revisions production runs, and what to do when a catalog change needs a boxel deploy. Use when asked to deploy, release or ship the catalog, when a catalog change merged but isn't in production, when "Deploy catalog to production" or a "Deploy the pinned catalog" job fails, when CATALOG_DEPLOY_DISPATCH_TOKEN is missing, rejected or about to expire, or before merging a catalog change that needs platform code production doesn't run yet.
---

# Deploying the catalog

The catalog realm (`/catalog/`) serves boxel-catalog's files, and its cards import the boxel platform the environment runs. A catalog change that needs boxel code breaks an environment whose boxel doesn't have that code yet. So each environment gets catalog changes on its own schedule:

| Environment | Its boxel                                       | Its catalog                                                                                  |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| staging     | boxel `main`, deployed on every merge           | catalog `main`, synced on every catalog merge (boxel-catalog's `sync-to-workspace.yml`)      |
| production  | whatever the last Manual Deploy [boxel] shipped | only what boxel-catalog's **Deploy catalog to production** (`deploy-production.yml`) deploys |

## Two ways a catalog change reaches production

- **In lockstep with boxel.** Manual Deploy [boxel] to production deploys the catalog revision the deployed boxel commit pins (`revision` in `packages/catalog/test-subset.json`), which boxel's tests ran against. It does this twice, through `packages/catalog/scripts/dispatch-catalog-deploy.sh`, waiting for each run:
  - **Before the release** (**Deploy the pinned catalog before the release**). The check runs against the boxel production still runs, so this ships the catalog changes the new boxel needs (a boxel pull request that says `Merges after: cardstack/boxel-catalog#N`), and refuses when the range has a catalog change that needs the new boxel. A refusal or failure here is only a notice and doesn't hold back the release.
  - **After the release** (**Deploy the pinned catalog after the release**). This ships the rest, such as catalog changes pinned by the boxel pull request that brings the code they need. If it fails or refuses, the job goes red: production then runs the new boxel against an older catalog.

  When production's catalog is already at the pin, both do nothing. When a single range holds catalog changes the new boxel needs _and_ ones that need the new boxel, the run before the release refuses, so the first kind reaches production only after the release.

- **Ahead of boxel, by hand.** A catalog change that needs nothing new from boxel doesn't have to wait for a boxel deploy. Run **Deploy catalog to production** from boxel-catalog's Actions tab with `revision` empty, which deploys catalog `main`'s head, or with a catalog `main` SHA.

Both go through the same check, and neither moves production's catalog backwards.

## What the deploy checks

`packages/catalog/scripts/catalog-deploy-check.ts`, run from boxel `main`:

1. **Is there anything to deploy?** It compares the catalog revision production last got (the newest successful `production` deployment recorded in boxel-catalog) with the target. A target at it is a green no-op. A target behind it deploys nothing either, since production's catalog never moves backwards, but the check still reads the catalog pull requests production keeps past the target. If any of them needs a boxel pull request production doesn't run, as after a boxel deploy of an older commit, it fails.
2. **Does every catalog change have the boxel code it needs?** For each catalog pull request merged between the two that changes a file the realm push uploads, it reads `Merges after: cardstack/boxel#N` from the description (the `catalog-pairing` skill has the syntax). Each such boxel pull request must have merged, and its merge commit must be in the boxel revision production runs (the newest successful `production` deployment in cardstack/boxel).
3. **Stacked pull requests.** A catalog pull request merged into another branch (a stack parent) still counts once its parent reaches `main`. A boxel pull request merged into a branch other than `main` hasn't landed, so it holds like an open one.
4. **Pull requests closed without merging don't count.** A closed catalog pull request never reached `main`. A `Merges after:` line naming a boxel pull request that was closed without merging holds nothing back. The check reports it as a warning naming both pull requests.

Changes that only touch files the realm push skips don't count: any path with a dot segment (`.github/`, `.claude/`), and what the catalog's root `.gitignore` and `.boxelignore` list (`README.md`, `AGENTS.md`, `scripts`, `tests`, …).

## Reading a refusal

A refusal names pull requests, not commits:

```
cardstack/boxel-catalog#775 "…" merges after cardstack/boxel#6416 "…", which production doesn't run yet: it runs cardstack/boxel@110504d5f727 (cardstack/boxel#6362 "…").
```

- **"which production doesn't run yet"**: the boxel pull request has merged but hasn't been deployed to production. Run Manual Deploy [boxel] to production. It deploys the catalog at the pin after the release.
- **"which hasn't merged yet"**: the catalog change merged ahead of the boxel change it needs. Merge the boxel pull request, then deploy boxel to production.
- **"production's catalog (at …) has … but production runs …, which doesn't have it"**: production's boxel is older than what its catalog needs, usually after a boxel deploy of an older commit. Deploy boxel at a commit that has the named boxel pull requests, or revert the catalog pull requests on catalog `main` and deploy the catalog by hand.
- **"isn't an ancestor of"**: the target isn't on catalog `main`'s history past what production has. Deploy a catalog `main` revision.

Nothing in production changes on a refusal. Catalog changes behind a held one stay undeployed too, because a later change can build on the held one. To ship catalog work ahead of a held change, revert the held change on catalog `main` first.

## Finding what production runs

```sh
# boxel: newest production deployment with a success status
gh api 'repos/cardstack/boxel/deployments?environment=production&per_page=5' --jq '.[] | "\(.id) \(.sha)"'
gh api repos/cardstack/boxel/deployments/<id>/statuses --jq '[.[].state]'

# catalog: the same, in boxel-catalog
gh api 'repos/cardstack/boxel-catalog/deployments?environment=production&per_page=5' --jq '.[] | "\(.id) \(.sha) \(.payload)"'

# the catalog pin of a boxel commit
gh api 'repos/cardstack/boxel/contents/packages/catalog/test-subset.json?ref=<sha>' --jq '.content' | base64 -d | jq -r .revision
```

The check runs locally too, read-only:

```sh
GH_TOKEN=$(gh auth token) node packages/catalog/scripts/catalog-deploy-check.ts \
  --catalog-to=<catalog sha> --catalog-dir=<a boxel-catalog checkout> --out=/tmp/check.json
```

## Before merging a catalog change that needs boxel code

Declare the pair, even if Lint Catalog wouldn't make you: the boxel pull request says `Merges before: cardstack/boxel-catalog#N`, and the catalog one says `Merges after: cardstack/boxel#M`. Lint Catalog requires a pair only when the change breaks catalog lint. A runtime dependency, such as a declaration option only new platform code accepts, lints clean, and only the `Merges after:` line keeps a by-hand deploy from shipping it early. A dependency written only in prose is invisible to the check.

## The dispatch token

Both lockstep jobs start the catalog deploy with `CATALOG_DEPLOY_DISPATCH_TOKEN`, a secret in cardstack/boxel holding a fine-grained token: resource owner cardstack, only cardstack/boxel-catalog, **Actions: Read and write**.

- **Missing, expired or revoked**: the job fails with `CATALOG_DEPLOY_DISPATCH_TOKEN is not set` or `GitHub rejected CATALOG_DEPLOY_DISPATCH_TOKEN`, and names the catalog revision to deploy by hand. Before the release, that failure doesn't hold back the release; after it, it turns the run red.
- **Read-only Actions access**: the dispatch is refused with `It needs Actions read and write`.
- **Expiring within 30 days**: each run warns with the expiry date. GitHub sends the date on every response the token signs.

To fix any of these, generate a new token with the settings above, replace the secret, and run **Deploy catalog to production** with the revision the error names.
