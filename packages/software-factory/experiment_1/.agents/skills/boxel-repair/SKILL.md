---
name: boxel-repair
description: Use when a Boxel workspace has broken realm metadata, missing icons or backgrounds, bad `index.json` or `cards-grid.json` links, or stale Matrix realm metadata that needs `boxel repair-realm` or `boxel repair-realms`.
---

# Boxel Repair

Use this workflow when a workspace has any of these symptoms:
- Missing icon/background in workspace tiles
- Display name is `Unknown Workspace` or mismatched
- Opening a workspace fails due to missing `cards-grid` relationship
- Matrix workspace list (`app.boxel.realms`) is stale/inconsistent

## Commands

```bash
# Inspect one realm without mutating
boxel repair-realm <workspace-url> --dry-run

# Repair one realm
boxel repair-realm <workspace-url>

# Repair all realms owned by active profile user
boxel repair-realms
```

## Behavior

`repair-realm` and `repair-realms` perform these repairs:
- `.realm.json`: normalize `name`, `iconURL`, `backgroundURL`
- `index.json`: ensure `relationships.cardsGrid.links.self` = `./cards-grid`
- `cards-grid.json`: restore default cards-grid card if missing/corrupt
- Before replacing `index.json`/`cards-grid.json`, preserve existing content as timestamped backup cards in the same realm
- `index.json`: write `data.meta._touched` timestamp to break cache
- Matrix `app.boxel.realms`: reconcile list to match repaired, accessible realms

## Important Defaults

- `personal` realm is excluded unless `--include-personal` is provided.
- Batch repair defaults to active profile owner.
- Use `--no-reconcile-matrix` when you want file/card repair only.
- Use `--no-fix-index`/`--no-touch-index` when debugging minimal metadata-only fixes.
