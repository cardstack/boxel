---
name: catalog-deploy
description: How a boxel-catalog change reaches staging and production, and how to deploy the catalog to production — every catalog merge syncs staging; production gets the catalog only from boxel-catalog's "Deploy catalog to production" workflow, started either by hand (to ship catalog work ahead of boxel) or by Manual Deploy [boxel] to production (which deploys the catalog revision the deployed boxel pins, in lockstep). Covers what the deploy checks before it changes anything (catalog pull requests that declare `Merges after:` a boxel pull request production doesn't run yet), how to read its refusal and its "nothing to do" skip, how to find which boxel and catalog revisions production runs, and what to do when a catalog change needs a boxel deploy. Use when asked to deploy, release or ship the catalog, when a catalog change merged but isn't in production, when "Deploy catalog to production" or the "Deploy the pinned catalog" job fails, or before merging a catalog change that needs platform code production doesn't run yet.
---

# Deploying the catalog

The catalog realm (`/catalog/`) serves boxel-catalog's files, and its cards import the boxel platform the environment runs. A catalog change that needs boxel code breaks an environment whose boxel doesn't have that code yet. So each environment gets catalog changes on its own schedule:

| Environment | Its boxel                                       | Its catalog                                                                                  |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| staging     | boxel `main`, deployed on every merge           | catalog `main`, synced on every catalog merge (boxel-catalog's `sync-to-workspace.yml`)      |
| production  | whatever the last Manual Deploy [boxel] shipped | only what boxel-catalog's **Deploy catalog to production** (`deploy-production.yml`) deploys |

## Two ways a catalog change reaches production

- **In lockstep with boxel.** When Manual Deploy [boxel] to production finishes, its **Deploy the pinned catalog** job starts the catalog deploy with `revision` set to the catalog revision the deployed boxel commit pins (`revision` in `packages/catalog/test-subset.json`). Boxel's tests ran against that revision, and a catalog change that needs new boxel code is pinned by the boxel pull request that brings that code. So it reaches production when that boxel commit does, with nobody deciding when. If production's catalog is already at or past the pin, the deploy does nothing.
- **Ahead of boxel, by hand.** A catalog change that needs nothing new from boxel doesn't have to wait for a boxel deploy. Run **Deploy catalog to production** from boxel-catalog's Actions tab with `revision` empty, which deploys catalog `main`'s head, or with a catalog `main` SHA.

Both go through the same check, and neither moves production's catalog backwards.

## What the deploy checks

`packages/catalog/scripts/catalog-deploy-check.ts`, run from boxel `main`:

1. **Is there anything to deploy?** It compares the catalog revision production last got (the newest successful `production` deployment recorded in boxel-catalog) with the target. A target at or behind it is a green no-op: "already at or past … Nothing to deploy."
2. **Does every catalog change have the boxel code it needs?** For each catalog pull request merged between the two that changes a file the realm push uploads, it reads `Merges after: cardstack/boxel#N` from the description (the `catalog-pairing` skill has the syntax). Each such boxel pull request must have merged, and its merge commit must be in the boxel revision production runs (the newest successful `production` deployment in cardstack/boxel).
3. **Pull requests closed without merging don't count.** A closed catalog pull request never reached `main`. A `Merges after:` line naming a boxel pull request that was closed without merging holds nothing back. The check reports it as a warning naming both pull requests.

Changes that only touch files the realm push skips don't count: any path with a dot segment (`.github/`, `.claude/`), and what the catalog's root `.gitignore` and `.boxelignore` list (`README.md`, `AGENTS.md`, `scripts`, `tests`, …).

## Reading a refusal

A refusal names pull requests, not commits:

```
cardstack/boxel-catalog#775 "…" merges after cardstack/boxel#6416 "…", which production doesn't run yet: it runs cardstack/boxel@110504d5f727 (cardstack/boxel#6362 "…").
```

- **"which production doesn't run yet"**: the boxel pull request has merged but hasn't been deployed to production. Run Manual Deploy [boxel] to production. Its last job deploys the catalog at the pin when the platform is live.
- **"which hasn't merged yet"**: the catalog change merged ahead of the boxel change it needs. Merge the boxel pull request, then deploy boxel to production.
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

## When the lockstep job can't start the deploy

**Deploy the pinned catalog** needs the `CATALOG_DEPLOY_DISPATCH_TOKEN` secret in cardstack/boxel. That's a fine-grained token with Actions read and write on cardstack/boxel-catalog. Without it, the job warns with the pin to deploy and passes. Run **Deploy catalog to production** with that `revision` by hand.
