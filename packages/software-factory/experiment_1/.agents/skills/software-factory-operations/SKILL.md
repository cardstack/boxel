---
name: software-factory-operations
description: Use when building or extending an application through the Boxel software-factory workflow in this repo, especially when the task should be broken into tickets, stored in Boxel, implemented in a target realm, verified with Playwright, and synced/checkpointed incrementally.
---

# Software Factory Operations

Use this skill when the objective is not just to write code, but to run the full Boxel software-factory loop successfully.

## Read First

- `AGENTS.md`
- `.boxel-workspaces.json`

## Realm Map

- `./realms/guidance-tasks`
  Shared tracker schema and demo cards. Import tracker modules from here.
- `./realms/software-factory-demo`
  Default implementation realm for the current demo and the place to build new artifacts.

Use `boxel realms --llm` whenever file placement is unclear.

## Working Commands

- Search a realm:
  `npm run boxel:search -- --realm <realm-url> --size 20`
- Pick backlog tickets:
  `npm run boxel:pick-ticket -- --realm <realm-url> --module http://localhost:4201/factory/guidance-tasks/darkfactory-schema`
- Get browser auth payloads:
  `npm run boxel:session -- --realm <realm-url>`
- Run browser verification:
  `npm run test:ticket-flow`
- Run Boxel-hosted project tests:
  `npm run test:realm -- --realm-path ./realms/<project-realm>`
- Sync implementation realm:
  `boxel sync ./realms/software-factory-demo --prefer-local`
- Create manual checkpoints:
  `boxel history ./realms/software-factory-demo -m "<message>"`

## Required Flow

1. Search for backlog tickets in the target implementation realm.
2. Move the chosen ticket to `in_progress` before implementation.
3. Build the requested Boxel files in the implementation realm.
4. Keep product-specific Playwright specs and fixture files in the implementation realm when they should persist with the project.
5. Prefer fixture-driven verification through a fresh scratch realm created by `npm run test:realm`.
6. Verify the resulting card URL with Playwright.
7. Update ticket notes, acceptance criteria, and related knowledge.
8. Sync to Boxel and create meaningful checkpoints.
9. Commit repo-side tooling or instruction changes in git.

## Important Gotchas

- For tracker searches, use the schema module URL:
  `http://localhost:4201/factory/guidance-tasks/darkfactory-schema`
- If a card in one private realm imports definitions from another private realm, seed browser auth for both realms.
- Realm-hosted test fixtures should usually be stored as final realm-relative paths under `tests/fixtures/`.
- Scratch realms should be checked out under the canonical Boxel workspace path layout, not ad hoc folders, so `boxel` commands do not keep reporting legacy workspace locations.
- If a fixture card instance is meant to run in a scratch realm, use an absolute `adoptsFrom.module` URL whenever the backing definition lives in the source realm.
- Boxel host pages keep long-lived network activity. In Playwright, do not wait for `networkidle`; use `domcontentloaded` plus visible assertions.
- `guidance-tasks` is a shared schema realm, not the place to build product-specific implementation files.
