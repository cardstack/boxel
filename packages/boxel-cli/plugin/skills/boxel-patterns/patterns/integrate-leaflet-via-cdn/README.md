---
validated: source-proven
---

# integrate-leaflet-via-cdn — Leaflet map inside a card, loaded from ESM CDN

**What this gives you:** A working interactive map (tiles, markers, popups, geojson layers) inside a Boxel card's `isolated` template — no build step, no realm-bundle change.

**When to use:** Location-based cards (real-estate listings, travel, store finders), geo-tagged data visualization, route displays, anywhere `<map>` would help.

**The insight:** Leaflet is a mature ESM-compatible library that loads cleanly from esm.sh or esm.run. The challenges are the same as `integrate-three-js-via-cdn` — lifecycle management and explicit container size — plus Leaflet needs its CSS to render correctly. Import the CSS via a CDN `<link>` (or inline it) so tiles and controls look right.

**Recipe shape:**

```ts
import { modifier } from 'ember-modifier';
import L from 'https://esm.sh/leaflet@1.9.4';

const leafletMapModifier = modifier(
  (element: HTMLElement, [config]: [{ center: [number, number]; zoom: number }]) => {
    const map = L.map(element).setView(config.center, config.zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    return () => {
      map.remove();   // 🎯 Removes tile layer, controls, and DOM
    };
  },
);
```

And the template:

```hbs
<link rel='stylesheet' href='https://esm.sh/leaflet@1.9.4/dist/leaflet.css' />
<div class='map-host' {{leafletMapModifier this.config}}></div>
```

**Gotchas:**
- **Leaflet CSS is required.** Without it, tiles overlap and controls don't position. The simplest fix is the `<link>` tag in the template (Boxel doesn't strip head-style links from templates).
- **Container needs explicit dimensions.** Same as Three.js — a zero-height container produces a blank map.
- **`map.remove()` does the full cleanup.** Don't try to dispose listeners or tile layers individually.
- **Marker icons require an absolute URL** because Leaflet's default expects a relative path that won't resolve from a Boxel realm. Use `L.icon({ iconUrl: 'https://esm.sh/leaflet@1.9.4/dist/images/marker-icon.png', ... })`.
- **Version pinning.** Use a pinned URL (`leaflet@1.9.4`) and re-check periodically. Latest can change without notice on esm CDNs.

**Source:** Several realms use this pattern for geo-cards. The canonical recipe was extracted from BSL-STUDY V1 entries that cite Leaflet usage.

**See also:** `integrate-three-js-via-cdn`, `pick-geo-point` (planned, for the FieldDef that lat/lng coordinates would live in), `boxel/references/external-libraries.md`.
