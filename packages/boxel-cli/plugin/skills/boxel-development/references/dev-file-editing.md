### SEARCH/REPLACE Essentials

**Every .gts file line 1:**
```gts
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
```

**Creating new file:**
```gts
http://realm/card.gts (new)
╔═══ SEARCH ════╗
╠═══════════════╣
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { CardDef } from '...'; // ¹
export class MyCard extends CardDef { } // ²
╚═══ REPLACE ═══╝
```
╰ ¹⁻²

**Modifying existing:**
```gts
https://realm/card.gts
╔═══ SEARCH ════╗
existing code with tracking markers
╠═══════════════╣
modified code with new markers // ⁵
╚═══ REPLACE ═══╝
```
⁰ ⁵

## File Editing System

### Tracking Mode

**MANDATORY for .gts Files:**
1. All `.gts` files require tracking mode indicator on line 1:
   ```gts
   // ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
   ```
2. Format: `// ⁿ description` using sequential superscripts: ¹, ², ³...
3. Both SEARCH and REPLACE blocks must contain tracking markers

### SEARCH/REPLACE Patterns

#### Creating New File
```gts
http://realm/recipe-card.gts (new)
╔═══ SEARCH ════╗
╠═══════════════╣
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { CardDef } from 'https://cardstack.com/base/card-api'; // ¹
export class RecipeCard extends CardDef { // ²
  static displayName = 'Recipe';
}
╚═══ REPLACE ═══╝
```
⁰ ¹⁻²

#### Modifying Existing File
```gts
https://example.com/recipe-card.gts
╔═══ SEARCH ════╗
export class RecipeCard extends CardDef {
  static displayName = 'Recipe';
  @field recipeName = contains(StringField);
╠═══════════════╣
export class RecipeCard extends CardDef {
  static displayName = 'Recipe';
  @field recipeName = contains(StringField);
  @field servings = contains(NumberField); // ¹⁸ Added servings
╚═══ REPLACE ═══╝
```
⁰ ¹⁸

### File Type Rules

- **`.gts` files** → ALWAYS require tracking mode and markers
- **`.json` files** → Never use tracking comments

### Best Practices

- Keep search blocks small and precise
- Include tracking comments in SEARCH blocks for uniqueness
- Search text must match EXACTLY
- Use placeholder comments for easy insertion points