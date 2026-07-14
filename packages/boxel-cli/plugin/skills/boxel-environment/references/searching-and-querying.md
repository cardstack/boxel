---
name: searching-and-querying
description: Finding cards with the search-cards host commands and query syntax.
boxel:
  kind: skill
  tools:
    - codeRef:
        module: '@cardstack/boxel-host/tools/search-cards'
        name: SearchCardsByTypeAndTitleCommand
        requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/search-cards'
        name: SearchCardsByQueryCommand
        requiresApproval: false
---

## Query Structure

**Always wrap filter in query object:**

```json
{
  "query": {
    "filter": {
      "on": { "module": "...", "name": "Product" },
      "contains": { "name": "laptop" }
    }
  }
}
```

**Operations:** `eq`, `in`, `contains`, `range`, `not`, `type`, `every` (AND), `any` (OR)

**Find instances after schema change:**

```json
{
  "query": {
    "filter": {
      "type": { "module": "...", "name": "Employee" }
    }
  }
}
```

### SearchCardsByQueryCommand

**Full tool call syntax:**

```json
{
  "name": "SearchCardsByQueryCommand_847d",
  "payload": {
    "description": "Search for products with 'laptop' in the name",
    "attributes": {
      "query": {
        "filter": {
          "on": {
            "module": "https://[boxel-app-domain]/jenna/shop/product",
            "name": "Product"
          },
          "contains": { "name": "laptop" }
        },
        "sort": [
          {
            "by": "price",
            "on": {
              "module": "https://[boxel-app-domain]/jenna/shop/product",
              "name": "Product"
            },
            "direction": "asc"
          }
        ]
      }
    }
  }
}
```

### SearchCardsByTypeAndTitleCommand

**Full tool call syntax:**

```json
{
  "name": "SearchCardsByTypeAndTitleCommand_a959",
  "payload": {
    "description": "Search for reports with the title 'quarterly report'",
    "attributes": {
      "title": "quarterly report",
      "cardType": "https://[boxel-app-domain]/emma/finance/report#Report"
    }
  }
}
```
