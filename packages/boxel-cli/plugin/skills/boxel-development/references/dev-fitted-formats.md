## Fitted Format Essentials

**Four sub-formats strategy:**
- **Badge** (≤150px width, <170px height) - Exportable graphics
- **Strip** (>150px width, <170px height) - Dropdown/chooser panels
- **Tile** (<400px width, ≥170px height) - Grid viewing
- **Card** (≥400px width, ≥170px height) - Full layout

**Container query skeleton:**

The base `field-component` already provides `container-name: fitted-card; container-type: size` on the fitted card wrapper — you do not need to redeclare these on your template root. Use the named container in `@container` queries. 

This is also safer in nested situations: `@container fitted-card (...)` skips any anonymous intermediate containers and always targets the nearest `fitted-card` boundary, so nested fitted cards each correctly respond to their own wrapper.

```css
/* Hide all by default */
.badge, .strip, .tile, .card {
  display: none;
  padding: clamp(0.25rem, 2cqmin, 0.5rem);
}

/* Activate by size using the named fitted-card container */
@container fitted-card (max-width: 150px) and (max-height: 169px) {
  .badge { display: flex; }
}
```

**Content priority:**
1. Title/Name
2. Image
3. Short ID
4. Key info
5. Status badges
