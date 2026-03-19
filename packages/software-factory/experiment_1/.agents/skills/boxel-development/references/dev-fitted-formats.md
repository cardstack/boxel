## Fitted Format Essentials

**Four sub-formats strategy:**
- **Badge** (≤150px width, <170px height) - Exportable graphics
- **Strip** (>150px width, <170px height) - Dropdown/chooser panels
- **Tile** (<400px width, ≥170px height) - Grid viewing
- **Card** (≥400px width, ≥170px height) - Full layout

**Container query skeleton:**
```css
.fitted-container {
  container-type: size;
  width: 100%;
  height: 100%;
}

/* Hide all by default */
.badge, .strip, .tile, .card {
  display: none;
  padding: clamp(0.25rem, 2%, 0.5rem);
}

/* Activate by size - NO GAPS! */
@container (max-width: 150px) and (max-height: 169px) {
  .badge { display: flex; }
}
```

**Content priority:**
1. Title/Name
2. Image
3. Short ID
4. Key info
5. Status badges