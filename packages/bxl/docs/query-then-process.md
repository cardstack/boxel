# Query Then Process

BXL should not become the application's retrieval language. Use the host query language to retrieve a bounded, ordered result set, then use BXL to process the JSON that came back.

This is the same split that makes jq useful in browser and CLI workflows:

1. Query: choose the resources, search space, ordering, and page boundary.
2. Process: reshape, calculate, validate, summarize, or decorate the returned JSON.

The query step is authoritative for filtering, relevance, sorting, and pagination. The process step is authoritative for JSON transformation.

## Shape

```ts
queryThenProcess({
  query: {
    filter: {
      every: [
        { type: InvoiceRef },
        { eq: { status: 'open' } },
        { range: { amount: { gte: 1000 } } },
      ],
    },
    sort: [{ by: 'createdAt', direction: 'desc' }],
    page: { size: 100 },
  },

  process: `
    map({
      id: .id,
      vendor: .vendorName,
      total: ROUND((.amount // 0) + (.tax // 0), 2)
    })
  `,
});
```

The process expression runs over the query result, not the whole database. If the query returns 100 invoices, BXL sees those 100 invoices.

## Boxel Query Language Example

Use the query language when you already know the exact retrieval shape:

```ts
const query = {
  filter: {
    every: [
      { type: InvoiceRef },
      { eq: { status: 'open' } },
      { range: { amount: { gte: 1000 } } },
      { has: { departmentTags: 'Finance' } },
    ],
  },
  search: {
    queries: [
      { kind: 'match', text: '"late fee" OR "service charge"' },
      { kind: 'about', text: 'invoices with unusual service charges' },
    ],
    mode: 'balanced',
  },
  sort: [
    { by: 'createdAt', direction: 'desc', nulls: 'last' },
    { by: 'amount', direction: 'desc' },
  ],
  page: { size: 100 },
};
```

This is not BXL. It is the retrieval contract. It can be planned, indexed, paginated, and explained by the host.

Then process the bounded result with BXL:

```bxl
map(
  LET(
    serviceTotal,
    SUM([.lineItems[] | select(.category == "Service") | .lineTotal]),
    {
      id: .id,
      vendor: .vendorName,
      serviceTotal: ROUND(serviceTotal, 2),
      tax: ROUND(serviceTotal * 0.0825, 2),
      reviewBand: IF((.amount // 0) >= 10000, "director-review", "standard")
    }
  )
)
```

The BXL expression uses jq's JSON traversal and Excel's calculation surface together:

- `map(...)` iterates over the returned invoices.
- `SUM(...)`, `ROUND(...)`, `IF(...)`, and `LET(...)` are Excel-style calculation helpers.
- `select(...)` and `.lineItems[]` are jq-native JSON traversal.
- `//` is jq null coalescing.

## Predicate Pushdown Is A Convenience Bridge

Sometimes the author does not want to write a precise query filter. In that case, the query can accept a BXL predicate and ask the compiler to lower the safe subset into the query plan:

```ts
const query = {
  type: InvoiceRef,
  where: {
    expression: 'Status = "Open" and Amount >= 1000 and Department IN @User.Departments',
  },
  sort: [{ by: 'createdAt', direction: 'desc' }],
  page: { size: 100 },
};
```

That is readable BXL predicate syntax. The compiler canonicalizes it to jq-shaped BXL before planning:

```jq
.status == "Open" and .amount >= 1000 and (.department | IN(@User.Departments))
```

The predicate compiler can turn the BXL predicate into a structured query filter or SQL fragment. If the predicate asks for compute-only behavior, compilation fails instead of silently scanning every row:

```bxl
words(Description) > 500
```

That failure is intentional. Predicate pushdown is best-effort translation of safe query-shaped BXL, not permission to run arbitrary BXL over an unbounded table.

## Illustrative PostgreSQL JSONB Lowering

A host storing card-like JSON documents in PostgreSQL might lower the query above to SQL like this:

```sql
select
  id,
  data->>'type' as type,
  data->'attributes' as attributes
from boxel_documents
where data->>'type' = 'invoice-card'
  and data->'attributes'->>'status' = 'open'
  and (data->'attributes'->>'amount')::numeric >= $1
  and data->'attributes'->'departmentTags' ? $2
order by
  (data->'attributes'->>'createdAt')::timestamptz desc nulls last,
  (data->'attributes'->>'amount')::numeric desc
limit 100;
```

Parameters:

```ts
[1000, 'Finance']
```

The SQL is illustrative, not the BXL contract. The important point is that the retrieval layer can use database indexes and stable pagination before BXL runs.

The returned JSON might be normalized for processing:

```json
[
  {
    "id": "inv_104",
    "vendorName": "Acme Corp",
    "status": "open",
    "amount": 1200,
    "tax": 99,
    "createdAt": "2026-04-03T10:30:00Z",
    "lineItems": [
      { "category": "Service", "lineTotal": 800 },
      { "category": "Hardware", "lineTotal": 400 }
    ]
  }
]
```

Then BXL processes that JSON:

```bxl
map({
  id: .id,
  vendor: .vendorName,
  serviceTotal: SUM([.lineItems[] | select(.category == "Service") | .lineTotal]),
  totalWithTax: ROUND((.amount // 0) + (.tax // 0), 2)
})
```

Result:

```json
[
  {
    "id": "inv_104",
    "vendor": "Acme Corp",
    "serviceTotal": 800,
    "totalWithTax": 1299
  }
]
```

## What Not To Do

Do not use BXL process expressions as the authoritative sort for a server-scale, paginated list:

```bxl
sort_by(.createdAt) | reverse
```

That only sorts the JSON already returned to BXL. If the query page size is 100, it sorts those 100 rows, not every eligible row in storage.

Do not use arbitrary BXL as an implicit fallback for failed predicate pushdown:

```bxl
Description | contains("urgent")
```

That may be useful after a bounded query result has been retrieved, but it should not silently become a full-table in-memory filter.

## Rule

Query first. Process second.

- Retrieval language: filtering, search relevance, ordering, pagination.
- Predicate-profile BXL: optional best-effort authoring sugar for safe boolean filters.
- Compute-profile BXL: post-query JSON processing with jq traversal and Excel calculation power.
