# Card Lifecycle

This page traces the complete lifecycle of a card — from definition to rendering, through storage, indexing, and serving.

## Phase 1: Definition

A card begins as a `.gts` file in a realm:

```typescript
// /my-realm/task.gts
export class Task extends CardDef {
  static displayName = 'Task';
  @field title = contains(StringField);
  @field status = contains(StringField);
  @field assignee = linksTo(Person);
}
```

When this file is saved, the realm detects the change and triggers indexing.

## Phase 2: Compilation

The `.gts` file is compiled through Babel transforms:

```
task.gts
  ↓ GTS Parser (extract templates)
  ↓ Babel Transform (decorators, imports)
  ↓ Scoped CSS Transform (extract styles)
  ↓ AMD Module Transform
  ↓
task.js (executable)
```

The compiled module is cached in the `modules` table:

```sql
INSERT INTO modules (url, cache_scope, definitions, deps)
VALUES ('/my-realm/task', 'realm', '{...}', ARRAY['/base/card-api', '/base/string']);
```

## Phase 3: Indexing

The indexer processes the card definition:

1. **Parse exports** — identify `Task` as a card definition
2. **Extract fields** — `title` (StringField), `status` (StringField), `assignee` (linksTo Person)
3. **Build dependency graph** — Task depends on CardDef, StringField, Person
4. **Store in index** — write to `boxel_index`

## Phase 4: Instantiation

A card instance is created as a JSON file:

```json
// /my-realm/tasks/fix-bug.json
{
  "data": {
    "type": "card",
    "attributes": {
      "title": "Fix login bug",
      "status": "in-progress"
    },
    "relationships": {
      "assignee": {
        "links": { "self": "../person/alice" }
      }
    },
    "meta": {
      "adoptsFrom": { "module": "../task", "name": "Task" }
    }
  }
}
```

## Phase 5: Instance Indexing

The instance gets indexed differently from definitions:

1. **Load card class** — resolve `adoptsFrom` to get the `Task` class
2. **Deserialize** — create a `Task` instance from JSON
3. **Compute fields** — evaluate any `computeVia` functions
4. **Build search document** — flatten all fields for querying:
   ```json
   { "title": "Fix login bug", "status": "in-progress", "assignee.name": "Alice" }
   ```
5. **Prerender HTML** — render isolated, embedded, atom, fitted formats
6. **Store everything** — write to `boxel_index`:
   ```sql
   INSERT INTO boxel_index
     (url, realm_version, type, realm_url, pristine_doc, search_doc,
      isolated_html, embedded_html, atom_html, fitted_html, deps, types)
   VALUES (
     '/my-realm/tasks/fix-bug', 42, 'instance', '/my-realm/',
     '{"data": {...}}', '{"title": "Fix login bug", ...}',
     '<div class="task-isolated">...</div>',
     '<div class="task-embedded">...</div>',
     '<span>Fix login bug</span>',
     '<div class="task-fitted">...</div>',
     ARRAY['../task', '../person/alice'],
     ARRAY['/base/card-api/CardDef', '/my-realm/task/Task']
   );
   ```

## Phase 6: Discovery

The card is now discoverable via search:

```json
POST /_search
{
  "filter": {
    "type": { "module": "../task", "name": "Task" },
    "eq": { "status": "in-progress" }
  }
}
```

The query engine matches against the `search_doc` JSONB.

## Phase 7: Loading (Client)

When a user navigates to the card in the Host App:

```
URL: /my-realm/tasks/fix-bug
  ↓
Host App route extracts card URL
  ↓
Store.get('/my-realm/tasks/fix-bug')
  ↓
Fetch from realm (Accept: application/vnd.card+json)
  ↓
Realm Server returns JSON-API document
  ↓
Loader imports task.gts module
  ↓
Deserialize JSON → Task instance
  ↓
Cache in Store with reference tracking
```

## Phase 8: Rendering

The card renders through the Glimmer engine:

```
Task instance loaded
  ↓
Determine format (e.g., isolated)
  ↓
Get Task.isolated component
  ↓
Glimmer renders:
  <@fields.title />  → StringField.embedded component → "Fix login bug"
  <@fields.status />  → StringField.embedded component → "in-progress"
  <@fields.assignee /> → Person.embedded component → [Alice's card]
  ↓
Scoped CSS applied
  ↓
DOM mounted
```

## Phase 9: Editing

When the user switches to edit mode:

```
Format changes to 'edit'
  ↓
Get Task.edit component (or default)
  ↓
Fields render as inputs:
  <@fields.title />  → <input value="Fix login bug" />
  <@fields.status />  → <input value="in-progress" />
  <@fields.assignee /> → LinksToEditor component
```

## Phase 10: Saving

When the user saves changes:

```
User modifies title → "Fix login bug (urgent)"
  ↓
Glimmer tracking detects change
  ↓
UI re-renders immediately (optimistic)
  ↓
Store.save(task) called
  ↓
serializeCard(task) → JSON-API document
  ↓
PUT /my-realm/tasks/fix-bug
  Accept: application/vnd.card+json
  Body: { "data": { ... } }
  ↓
Realm Server writes file to disk
  ↓
Incremental reindex triggered
  ↓
Matrix event broadcast: card updated
  ↓
Other clients receive event and refresh
```

## Phase 11: Deletion

```
User deletes card
  ↓
Store.delete('/my-realm/tasks/fix-bug')
  ↓
DELETE /my-realm/tasks/fix-bug
  ↓
Realm Server removes file
  ↓
Index entry marked as deleted
  ↓
Reverse dependencies invalidated
  ↓
Matrix event broadcast: card deleted
```

## Lifecycle Diagram

```
Define (.gts) → Compile → Index Definition
                              ↓
Create (.json) → Index Instance → Prerender HTML
                              ↓
                    Searchable / Discoverable
                              ↓
Load (client) → Deserialize → Render → Edit → Save
                                               ↓
                                        Reindex → Broadcast
```

## Next Steps

- [Module Resolution](/architecture/module-resolution) — Compilation details
- [Data Flow](/architecture/data-flow) — Network-level data paths
- [Runtime Architecture](/architecture/runtime) — Engine internals
