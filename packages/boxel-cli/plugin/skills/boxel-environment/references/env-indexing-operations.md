# Indexing Operations

Indexing reads realm content and updates the search/query index used by Boxel.

## Invalidate Specific URLs

Use this when a user wants specific files re-indexed for a realm. The user may ask that the card be refreshed or reloaded when they want a card to be re-indexed.

### Preconditions

- User has `write` access to the target realm.
- `realmUrl` is known.
- `urls` contains the specific file or card URLs that should be re-indexed.

### Behavior

- Triggers incremental indexing for the specified URLs.
- Use this to target specific files instead of canceling or starting broader indexing work.
- The command accepts multiple URLs in one request.

### Command Call Template

```json
{
  "name": "invalidate-realm-urls_xxxx",
  "payload": {
    "description": "Trigger indexing for specific files in this realm",
    "attributes": {
      "realmUrl": "<realmUrl>",
      "urls": ["<url1>", "<url2>"]
    }
  }
}
```

## Reindex Realm

Use this when a user wants to reindex a realm using the normal, lighter/default mode.

### Preconditions

- User has `write` access to the target realm.
- `realmUrl` is known.

### Behavior

- Republishes a from-scratch indexing job in the lighter/default mode.
- Use this when the user wants to pick up normal recent changes or refresh a realm.
- This is broader than invalidating specific URLs and lighter than a full reindex.

### Command Call Template

```json
{
  "name": "reindex-realm_xxxx",
  "payload": {
    "description": "Reindex this realm using the default mode",
    "attributes": {
      "realmUrl": "<realmUrl>"
    }
  }
}
```

## Full Reindex Realm

Use this when a user wants a full rebuild of a realm index.

### Preconditions

- User has `write` access to the target realm.
- `realmUrl` is known.

### Behavior

- Forces a full realm reindex so every file is revisited.
- Use this when the user suspects indexing drift, stale results, or wants a deep/full refresh.
- This is heavier than the normal reindex command.

### Command Call Template

```json
{
  "name": "full-reindex-realm_xxxx",
  "payload": {
    "description": "Force a full reindex of this realm",
    "attributes": {
      "realmUrl": "<realmUrl>"
    }
  }
}
```

## Cancel Running Indexing Job

Use this when a user asks to stop indexing for a specific realm.

### Preconditions

- User has `write` access to the target realm.
- `realmUrl` is known.

### Behavior

- Cancels currently running jobs in concurrency group `indexing:<realmUrl>`.
- Includes both from-scratch and incremental indexing jobs.
- Does not cancel pending indexing jobs.
- Endpoint response is `204 No Content`, including no-op cases.

### Command Call Template

```json
{
  "name": "cancel-indexing-job_xxxx",
  "payload": {
    "description": "Cancel the currently running indexing job for this realm",
    "attributes": {
      "realmUrl": "<realmUrl>"
    }
  }
}
```
