### The Cardinal Rule

**MOST CRITICAL RULE:**
```gts
// ✅ CORRECT
@field author = linksTo(Author);          // CardDef
@field address = contains(AddressField);  // FieldDef

// ❌ WRONG - Will break everything
@field author = contains(Author);         // NEVER!
@field address = linksTo(AddressField);   // NEVER!
```

**Must export ALL classes:**
```gts
export class MyCard extends CardDef { }  // ✅
class MyCard extends CardDef { }         // ❌ Missing export
```

**Computed fields:**
- Keep simple and unidirectional
- No self-reference or cycles
- Wrap cross-card access in try-catch

## Technical Rules

### THE CARDINAL RULE: contains vs linksTo

**THIS IS THE #1 MOST CRITICAL RULE IN BOXEL:**

| Type | MUST Use | NEVER Use | Why |
|------|----------|-----------|-----|
| **Extends CardDef** | `linksTo` / `linksToMany` | ❌ `contains` / `containsMany` | CardDef = independent entity with own JSON file |
| **Extends FieldDef** | `contains` / `containsMany` | ❌ `linksTo` / `linksToMany` | FieldDef = embedded data, no separate identity |

```gts
// ✅ CORRECT
@field author = linksTo(Author);              // Author extends CardDef
@field address = contains(AddressField);      // AddressField extends FieldDef

// ❌ WRONG
@field author = contains(Author);             // NEVER!
@field address = linksTo(AddressField);       // NEVER!
```

### MANDATORY TECHNICAL REQUIREMENTS

1. **Always use SEARCH/REPLACE with tracking for .gts files**
2. **Export ALL CardDef and FieldDef classes inline**
3. **Never use reserved words as field names**
4. **Keep computed fields simple and unidirectional**
5. **No JavaScript in templates**
6. **Wrap delegated collections with spacing containers**

### TECHNICAL VALIDATION CHECKLIST

Before generating ANY code:
- [ ] SEARCH/REPLACE blocks with tracking markers
- [ ] Every CardDef field uses `linksTo`/`linksToMany`
- [ ] Every FieldDef field uses `contains`/`containsMany`
- [ ] All classes have `export` keyword inline
- [ ] No reserved words as field names
- [ ] No duplicate field definitions
- [ ] Computed fields are simple (no cycles!)
- [ ] Try-catch blocks wrap cross-card data access
- [ ] No JavaScript operations in templates
- [ ] ALL THREE FORMATS: isolated, embedded, fitted

### Common Mistakes

#### Using contains with CardDef
```gts
// ❌ WRONG
@field items = containsMany(Item); // Item is CardDef

// ✅ CORRECT
@field items = linksToMany(Item);
```

#### Missing Exports
```gts
// ❌ WRONG
class BlogPost extends CardDef { }

// ✅ CORRECT
export class BlogPost extends CardDef { }
```