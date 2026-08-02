# BXL mutation fixture corpus

[`bxl-mutation-examples.ts`](./bxl-mutation-examples.ts) is the executable,
pre-grammar design corpus for the mutation profile. It follows the existing
BXL corpus convention: committed TypeScript cases plus a small test runner.

Each accepted case records:

- a human intent;
- the loaded Card or Field value before the mutation;
- human-facing BXL readable statements and their schema-solidified,
  jq-shaped mutation BXL;
- equivalent structured tool-call operations;
- the normalized mutation-plan statements and concrete intents;
- the loaded value after applying the plan; and
- optional streaming chunks and returning data.

Rejected cases make dangerous near-misses part of the design: implicit bulk
writes, unstable indexes, incomplete streams, raw JSON:API paths, relationship
traversal, query-backed relationship writes, revision drift, and authorization
failure.

Run the semantic verifier with:

```sh
npm run example:mutation
```

Run only the realm-shaped seam—with committed Workspace, Contest, Classroom,
Zine, and query-backed relationship snapshots—with:

```sh
npm run example:mutation:realm
```

Those cases retain source-evidence metadata so an integration harness can
replace the snapshots with loaded Card Store models while reusing the same
plans and assertions.

Explore and run the same corpus in the standalone browser workbench with:

```sh
npm run demo:mutation
```

The workbench includes every accepted and rejected fixture, filters for each
pattern and feature, readable and schema-solidified source, structured AI tool calls,
before/after loaded models, normalized plans, and stepwise stream replay. Its
browser verifier is the same module used by the CLI test above.

The verifier currently checks readable and canonical framing, statement-count
equivalence, structured-operation identities, coverage of the ten syntax
questions, streaming chunk reconstruction, loaded relationship boundaries,
and `before -> normalized plan -> after`. It does not parse the mutation
statement source yet. That is deliberate: the accepted examples should settle
before they become grammar compatibility commitments.

## Loaded relationship model

Mutation BXL transforms the model returned by the Card Store, not a raw card
resource document. A `linksTo` field appears as a loaded Card and a
`linksToMany` field appears as an ordered array of loaded Cards. For example:

```bxl
Winner = card("card:submission/tidal");
append("Entry Point", card("card:collab-stage"));
del("Entry Point"[ID = "card:architecture"]);
move_item_before(
  "Entry Point"[ID = "card:attendance"],
  "Entry Point"[ID = "card:collab-stage"]
);
```

The `card(id)` expression resolves and type-checks the Card through the Card
Store. Schema-directed lowering turns these ordinary assignment and collection
forms into `relate`, `unrelate`, and `move-relation` plan intents.

The author never sees or manufactures persistence keys such as
`entryPoints.0`. JSON:API serialization belongs solely to the commit adapter.
Query-backed `linksToMany` membership is derived and therefore read-only.

## Real-shape evidence

The initial cases generalize shapes observed in Boxel workspaces:

- Workspace `entryPoints = linksToMany(CardDef)`, whose component appends and
  removes loaded Cards by assigning a new array;
- Contest `submissions = linksToMany(Submission)` and singular `winner`;
- Classroom and zine instances with multiple indexed relationship members;
- query-backed student directories; and
- the Scrabble stream prototype's incremental statement framing and granular
  Yjs mutations.

The raw instance files demonstrate why the loaded-model boundary matters:
`linksToMany` persists as separate `field.0`, `field.1`, and later relationship
records. Those records are adapter details, not a tree an LLM should rewrite.
