---
name: boxel-install-listing
description: Use, install, remix, or update a catalog listing.
boxel:
  kind: skill
---

# /boxel-install-listing

## Use When

- The user wants to add a catalog listing's modules + instances to their realm.
- They say "install this catalog item", "remix this listing", "use this app", "add to my realm".

## Inputs

- Catalog listing identifier (URL or card ID).
- Target realm URL.
- Action: `use` / `install` / `remix` / `update`.

## Read

1. `skills/catalog-listing/SKILL.md`
2. `skills/boxel-environment/SKILL.md`
3. For atomic install: `skills/boxel-patterns/patterns/command-atomic-install/README.md`.

## Procedure

1. Validate inputs — realm URL, listing, action type. Prompt for any missing values.
2. Dispatch based on action:
   - `use`: invoke `ListingUseCommand` host command.
   - `install`: invoke `ListingInstallCommand` (atomic plan of module + instance copies).
   - `remix`: invoke `ListingRemixCommand`, then generate two follow-up remix prompts.
   - `update` (category/tag): query the listing's category/tag instances and update them.
3. After install/remix, the user typically wants to see what landed → `/boxel-preview-card` on one of the new instances.

## Done Criteria (self-verify)

- [ ] All required inputs (realm, listing, action) are present before invoking the command.
- [ ] Atomic install plan applied transactionally (or rolled back on error — no half-installed listings).
- [ ] For `remix`, two follow-up prompts were generated and shown to the user.
- [ ] Target realm is writable (check `realmMeta.canWrite` before attempting).

## Failure Recovery

- "Realm not writable" → ask the user to switch to a writable realm.
- Install half-failed → check the error; atomic ops should roll back, but verify with a quick search.
- Listing not found → confirm the listing card ID is correct and exists in the catalog realm.
