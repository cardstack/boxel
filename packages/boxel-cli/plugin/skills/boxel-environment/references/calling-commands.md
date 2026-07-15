## 🎯 Command Call Template (CRITICAL - FOLLOW EXACTLY)

### ⚠️ STOP AND READ BEFORE ANY COMMAND CALL

**The #1 error is malformed command calls. MEMORIZE this exact JSON shape:**

```
{
  "name": "command-name_xxxx",
  "payload": {
    "description": "...",
    "attributes": { ...key-value pairs here... }
  }
}
```

### 📐 VISUAL MAP (Study This Carefully)

```
┌─────────────────────────────────────────────────────┐
│ LEVEL 1 (root object)                               │
│ ┌─────────────────────────────────────────────────┐ │
│ │ "name": "show-card_566f"        ← STRING        │ │
│ │ "payload": {                    ← OBJECT        │ │
│ │   ┌───────────────────────────────────────────┐ │ │
│ │   │ LEVEL 2 (inside payload)                  │ │ │
│ │   │ "description": "What this does" ← STRING  │ │ │
│ │   │ "attributes": {                 ← OBJECT  │ │ │
│ │   │   ┌─────────────────────────────────────┐ │ │ │
│ │   │   │ LEVEL 3 (command-specific keys)     │ │ │ │
│ │   │   │ "cardId": "https://..."             │ │ │ │
│ │   │   │ "realm": "https://..."              │ │ │ │
│ │   │   │ "path": "Product/item.json"         │ │ │ │
│ │   │   └─────────────────────────────────────┘ │ │ │
│ │   │ }                                         │ │ │
│ │   └───────────────────────────────────────────┘ │ │
│ │ }                                               │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 🔢 The 3 Nesting Levels Explained

| Level | Key | Type | What Goes Here |
|-------|-----|------|----------------|
| **1** | `"name"` | STRING | Command name with hash suffix (e.g., `"show-card_566f"`) |
| **1** | `"payload"` | **OBJECT** | Wrapper that contains levels 2 and 3 |
| **2** | `"description"` | STRING | Brief text explaining what this call does |
| **2** | `"attributes"` | **OBJECT** | Contains level 3 key-value pairs |
| **3** | *(varies by command)* | varies | Command-specific keys like `cardId`, `realm`, `path`, etc. |

**⚠️ CRITICAL CLARIFICATION:** 
- Level 3 is NOT called "parameters" — it's just the key-value pairs INSIDE `attributes`
- The keys at level 3 vary per command (e.g., `cardId` for show-card, `realm` + `path` for write-text-file)
- `attributes` is ALWAYS a JSON object `{ }`, NEVER a string

### 🔴 THE ONE TRUE FORMAT (Copy This Exactly)

```json
{
  "name": "command-name_xxxx",
  "payload": {
    "description": "Brief description of what this does",
    "attributes": {
      "paramName": "value",
      "anotherParam": "value"
    }
  }
}
```

### 🚨 TYPE RULES (Non-Negotiable)
| Key | Type | Example |
|-----|------|--------|
| `"payload"` | OBJECT | `{ ... }` |
| `"description"` | STRING | `"Show the product card"` |
| `"attributes"` | OBJECT | `{ "cardId": "..." }` |

**NEVER:**
- `"attributes": "{\"cardId\": ...}"` ← STRING (wrong!)
- `"attributes": "<parameter>..."` ← XML (wrong!)
- `"arguments": { ... }` ← wrong key name!

## ✅ Pre-Flight Checklist

Before generating ANY command call, verify:
- [ ] Wrapped in `"payload": { }`
- [ ] Has `"description"` field (not empty)
- [ ] Has `"attributes"` as JSON object `{ }`
- [ ] NO `"arguments"` key (use `"payload"` instead)
- [ ] NO string-encoded JSON (attributes must be object, not string)
- [ ] NO XML syntax like `<parameter>`

## 📋 Working Examples

### Example 1: show-card
```json
{
  "name": "show-card_566f",
  "payload": {
    "description": "Display the burger menu card",
    "attributes": {
      "cardId": "https://realms-staging.stack.cards/workspace/Card/id"
    }
  }
}
```

### Example 2: write-text-file  
```json
{
  "name": "write-text-file_e5a1",
  "payload": {
    "description": "Create product instance file",
    "attributes": {
      "realm": "https://realm-url/",
      "path": "Product/item.json",
      "content": "{\"data\": {...}}",
      "overwrite": true
    }
  }
}
```
**Note:** `content` is a STRING containing serialized JSON or other escaped text content

### Example 3: Empty attributes (when no params needed)
```json
{
  "name": "some-command_xxxx",
  "payload": {
    "description": "Perform action without parameters",
    "attributes": {}
  }
}
```

## ⛔ Critical "Never Do This"

```json
❌ {"name": "...", "arguments": {...}}              → Missing "payload" wrapper
❌ {"payload": {"attributes": {...}}}               → Missing "description"
❌ {"payload": {"description": "...", ...}}         → Missing "attributes"
❌ {"attributes": "{\"key\": \"value\"}"}           → Attributes as string (must be object)
❌ {"attributes": "<parameter name='x'>val</..."}   → XML syntax (pure JSON only)
```
