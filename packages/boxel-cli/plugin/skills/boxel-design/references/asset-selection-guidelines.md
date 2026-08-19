## Asset Selection Guidelines

### Priority Order for Asset Integration

1. **Functionality First** - Asset must load without errors
   - Test all URLs before finalizing
   - Use fallback images for critical UI elements
   - Verify CORS headers for external resources
   - Check CDN stability (prefer established CDNs)

2. **Aesthetic Harmony** - Match the selected style reference
   - **Color grading**: Assets should complement the palette
   - **Visual weight**: Balance with overall composition
   - **Era/mood**: Vintage styles need period-appropriate imagery
   - **Quality**: Resolution and compression appropriate for use

3. **Content Relevance** - Support the narrative
   - Generic > specific when prototyping
   - Avoid overly literal interpretations
   - Consider cultural context and inclusivity

### Asset-to-Style Matching Guide

| Style Category | Asset Characteristics | Recommended Sources |
|----------------|----------------------|-------------------|
| **Minimal/Clean** | High whitespace, isolated subjects, neutral tones | Unsplash, Pexels (search: "minimal"), Burst |
| **Vintage/Retro** | Film grain, sepia/faded colors, historical subjects | Unsplash, Wikimedia Commons, NASA archives |
| **Tech/Futuristic** | Abstract patterns, gradients, dark backgrounds | Unsplash, Hero Patterns, SVGBackgrounds |
| **Editorial** | Documentary style, authentic moments, natural light | Unsplash, Pexels, Life of Pix |
| **Playful/Illustrated** | Flat colors, geometric shapes, consistent style | unDraw, Open Doodles |
| **Luxury/Fashion** | High contrast, dramatic lighting, premium textures | Unsplash, Burst (lifestyle), Pexels (fashion) |
| **Data/Scientific** | Charts, diagrams, technical imagery | NASA, NOAA, USGS |

### Quick URL Patterns for LLM Generation

**⚠️ Note: LLM constructs URLs based on patterns below - no search capability, just pattern-based generation**

```html
<!-- Pexels Photo Pattern -->
https://images.pexels.com/photos/[6-7 DIGITS]/pexels-photo-[SAME DIGITS].jpeg?auto=compress&cs=tinysrgb&w=1920
<!-- Try sequential IDs like: 1271619, 2102416, 3184292, 4145354 -->

<!-- Heroicons (reliable icon names) -->
https://unpkg.com/heroicons@2/24/outline/[ICON].svg
<!-- Common: star, heart, user, menu, search, home, settings, trash, plus, x, check, bell, mail -->

<!-- unDraw Illustrations (consistent slugs) -->
https://42f2671d685f51e10fc6-b9fcecea3e50b3b59bdc28dead054ebc.ssl.cf5.rackcdn.com/illustrations/[SLUG].svg
<!-- Common: designer, developer, team_work, data_processing, mobile_app, dashboard, analytics -->

<!-- SVG Patterns (predictable names) -->
https://www.svgbackgrounds.com/[PATTERN].svg?color=%23[HEX]&opacity=[0.1-1]
<!-- Patterns: topography, circuit-board, hexagons, temple, jupiter, overlapping-circles -->

<!-- Pixabay Fallback -->
https://cdn.pixabay.com/photo/2020/[01-12]/[01-31]/[ID]_640.jpg
<!-- Structure: year/month/day/id - try common dates and 7-digit IDs -->

<!-- NASA Public Domain -->
https://images-assets.nasa.gov/image/[MISSION-ID]/[MISSION-ID]~thumb.jpg
<!-- Common: PIA12345, as11-40-5874, hubble-arp273 -->

<!-- Placeholder Services (always work) -->
https://via.placeholder.com/[WIDTH]x[HEIGHT]/[BG-HEX]/[TEXT-HEX]?text=[TEXT]
https://picsum.photos/[WIDTH]/[HEIGHT]
https://source.unsplash.com/[WIDTH]x[HEIGHT]/?[KEYWORD]
```

### LLM Strategy for Asset Selection

1. **Start with placeholder services** for guaranteed working images
2. **Use common icon names** from Heroicons (star, heart, user, etc.)
3. **Try sequential Pexels IDs** in the millions range (1000000-9999999)
4. **Apply SVG patterns** with predictable names for backgrounds
5. **Fallback to solid colors** or gradients if external assets fail

### Working Examples (high success rate)

```html
<!-- Reliable hero images -->
<img src="https://picsum.photos/1920/1080" alt="Hero image">
<img src="https://source.unsplash.com/1920x1080/?technology" alt="Tech hero">

<!-- Common icons that exist -->
<img src="https://unpkg.com/heroicons@2/24/outline/star.svg" alt="Star">
<img src="https://unpkg.com/heroicons@2/24/outline/menu.svg" alt="Menu">

<!-- SVG patterns that work -->
<div style="background-image: url('https://www.svgbackgrounds.com/topography.svg?color=%23e0e0e0&opacity=0.4')">

<!-- Safe placeholder with custom text -->
<img src="https://via.placeholder.com/800x400/6366f1/ffffff?text=Welcome" alt="Welcome banner">
```

### Quick Integration Patterns

```html
<!-- Hero image with fallback -->
<img 
  src="https://images.pexels.com/photos/1234567/pexels-photo-1234567.jpeg?auto=compress&cs=tinysrgb&w=1920"
  onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 1920 1080\'%3E%3Crect fill=\'%23f3f4f6\' width=\'1920\' height=\'1080\'/%3E%3C/svg%3E'"
  alt="Descriptive text"
/>

<!-- Optimized background pattern -->
<div style="background-image: url('https://www.svgbackgrounds.com/topography.svg?color=%23000000&opacity=0.1')">

<!-- Icon with local fallback -->
<img src="https://unpkg.com/heroicons@2/24/outline/star.svg" 
     onerror="this.textContent='★'" />
```

### Asset Don'ts
- Using celebrity/branded content without permission
- Mixing incompatible visual styles (unless intentional)
- Low-res images stretched beyond their quality

**Remember:** A broken image destroys credibility faster than a generic placeholder. When in doubt, use abstract patterns or solid colors that match your theme.
