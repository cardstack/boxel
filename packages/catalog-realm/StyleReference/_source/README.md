# Style Reference Dataset

This directory holds the source-of-truth files for generating Style Reference
cards and their catalog listing entry. Keep the dataset light enough to edit
manually, and let the generator script transform it into the card JSON that a
realm expects.

## Files

- `style-references.json` – array of Style Reference objects. Each object
  contains the fields the generator needs to emit a fully formed card JSON file.
- `style-references.csv` – lightweight table for quick batch capture (name,
  inspiration snippets, asset URLs). Use it as a staging sheet before copying
  richer data into the JSON file.
- `style-reference-listing.json` – configuration for the catalog listing that
  aggregates Style Reference cards.

## Editing Workflow

1. Append new rows to the CSV while researching styles. Include at least the
   slug, name, and inspiration tags.
2. Copy each row into the JSON dataset and flesh out the detailed fields
   (visual DNA blurb, wallpapers, CSS imports, root/dark variables).
3. Run the generator script (see repository root `package.json` for the command)
   in small batches (≤30 cards) to avoid long writes,
   e.g. `pnpm generate:style-references --batch 0 24`.
4. Review the generated card files and the listing entry before committing.

> Keep entries alphabetised by slug so batch ranges remain predictable.

## Progress Checklist

- [x] 001 Ultra Minimal (Apple.com, Tesla.com, Muji) - Wide whitespace, grayscale, crisp sans, hero product photos, gentle motion
- [x] 002 Vintage Luxury (Gucci Vault, Burberry Archive, Hermes Heritage) - Sepia tones, serif heads, collage layout, gold-foil touches, patina textures
- [x] 003 Playful Illustration (Mailchimp, Slack, Headspace) - Flat doodles, chunky lines, pastel pops, witty copy, asym-grid
- [x] 004 Gradient Tech (Stripe, Linear.app, Raycast) - Dark background, vibrant gradients, glass cards, code snippets, sleek motion
- [x] 005 Kinetic Story (Nike Better World, Apple AirPods Pro, Spotify Unwrapped) - Scroll-parallax, big video, action type, dynamic panels
- [x] 006 Futurist Lab (SPACE10, Google ATAP, MIT Media Lab) - Dark mode, monospaced heads, WebGL, generative shapes, speculative copy
- [x] 007 Editorial Minimal (Cereal Magazine, Kinfolk, Monocle) - Wide margins, serif plus sans, muted photos, slow fades, magazine grid
- [x] 008 Inclusive Data-Viz (Volvo E.V.A, Gapminder, Our World in Data) - Soft blues, human icons, clean charts, WCAG focus
- [x] 009 Neon Maximalist (Razzle-Dazzle.one, MTV microsite, Adult Swim) - Fluoro palette, GIF layers, cursor effects, chaotic type
- [x] 010 Neo-Brutalist (Array-of-Stars, Brutalist.website, Gumroad) - Raw HTML vibe, thick borders, mono text, no shadows, broken grid
- [x] 011 Sensory Editorial (Aesop, Le Labo, Byredo) - Earth palette, slow cross-fade, fragrance-first, ambient audio
- [x] 012 Futurist Luxury (BMW i7, Mercedes EQS, Rolls-Royce Spectre) - Dark glass, holographic glow, hero video, sleek serif
- [x] 013 Activist Rugged (Patagonia, REI, The North Face) - Textured backgrounds, hand-drawn icons, bold calls to action, eco greens
- [x] 014 Vibrant Gradient (Adobe CC, Instagram, Spotify) - Kaleido blobs, radial gradients, floating cards, playful UI
- [x] 015 Luxe Commerce (Farfetch, Net-a-Porter, SSENSE) - Neutral canvas, editorial photos, thin serif, sticky filters
- [x] 016 Pop Data-Viz (Spotify Wrapped, Apple Music Replay, Strava Year in Sport) - Bright blocks, animated stats, share cards, burst transitions
- [x] 017 Monochrome Code (Vercel, GitLab, Railway) - Black-white, monospace snippets, grid cards, developer tone
- [x] 018 Skeuo-Story (IKEA Museum, LEGO timeline, Disney100) - Scrap-book edges, skeuo shadows, timeline scroller
- [x] 019 High-Fashion Immersive (Moncler Genius, Jacquemus, Balenciaga) - Dark glam, runway loops, oversized serif, hover reveals
- [x] 020 Cinematic Editorial (NYT Snow Fall, The Guardian Firestorm, National Geographic) - Full-bleed video, parallax chapters, map embeds
- [x] 021 Playful 3-D (LEGO Kids, Nintendo Labo, Minecraft Education) - WebGL bricks, primary palette, hover bounce, gamified navigation
- [x] 022 Minimal Monochrome (Notion, Linear docs, Obsidian) - Grey palette, minimal icons, modular blocks, calm motion
- [x] 023 Dark Cinematic (Netflix Tudum, HBO Max, Apple TV Plus) - Black UI, poster grid, red accent, trailer hovers
- [x] 024 Scientific 3-D (NASA Eyes, ESA Solar System, Google Earth) - Space black, 3-D models, telemetry overlays
- [x] 025 Creative Community (Dribbble, Behance, DeviantArt) - Masonry cards, pastel header, infinite scroll, like counters
- [x] 026 Kaleidoscope Deco (Palace Lido, Tame Impala site, The Great Gatsby 2013) - Art-deco frames, neon jewels, marquee text, ornate borders
- [x] 027 Raw Commerce (Gumroad, Carrd, Buy Me a Coffee) - Plain HTML, system font, instant checkout, bold links
- [x] 028 Swiss-Grid (Dropbox.design, GridSystem.io, Vignelli Center) - 12-column grid, Helvetica, numeric margins, red rules
- [x] 029 Swiss Modern (Swiss Air, Lufthansa, SBB Mobile) - ITS grid, left-aligned layouts, airline icons, primary red
- [x] 030 Retro Revival (Burger King rebrand, Pepsi Throwback, Pizza Hut Classic) - Brown-orange, chunky Cooper, wavy stripes, grain
- [x] 031 Luxury Maximal (LV Dream, Dolce & Gabbana, Versace Home) - Deep blacks, gold accents, flourish borders, luxe serif
- [x] 032 Humorous Parallax (Old Spice, Dollar Shave, Liquid Death) - Gag scroll, mascots, explosion GIFs, comic bubbles
- [ ] 033 Campaign 3-D (Heineken Closer, Coke Beat Heat, Nike You Cant Stop Us) - Rotating cans, neon glow, confetti, call-to-action modals
- [ ] 034 Maker Grid (Kickstarter, Indiegogo, Product Hunt) - Pastels, rounded cards, progress bars, community avatars
- [ ] 035 Friendly Fintech (Monzo, N26, Cash App) - Punchy coral, emoji icons, clean graphs, rounded sans
- [ ] 036 Blueprint Tokens (Atlassian Design, IBM Carbon, Shopify Polaris) - Component diagrams, token tables, code playground
- [ ] 037 ASCII Minimal (GitHub Octoverse, Terminal.css, Hacker News) - Monospace, ASCII charts, black screen, blinking cursor
- [ ] 038 Safety Blue (Volvo EV, Ford Sync, Waymo) - Sky-blue, inclusive imagery, infographic icons, checklists
- [ ] 039 Cause Interactive (UNICEF Tap, Charity Water, GoFundMe) - Aqua gradient, ripple cursor, donation meter
- [ ] 040 Museum Modernist (MoMA, Tate, Centre Pompidou) - White cube look, art-first, modernist grid
- [ ] 041 Typographic Lab (Cooper Hewitt Labs, Variable-Fonts, Google Fonts) - Oversized glyphs, sliders, neon guides, code panels
- [ ] 042 Climate Data (CNN Climate, CarbonClock, Climate.gov) - Urgent reds, stacked charts, timeline scrubber, CO2 counters
- [ ] 043 Fashion Immersive (Fendi, Bottega 360, Saint Laurent) - Edge-to-edge video, split lookbook, dark glamour
- [ ] 044 Retro Photography (Polaroid Originals, Kodak, Lomography) - Film frames, rainbow stripe, grain filter, script heads
- [ ] 045 Cyberpunk Neon (Synthwave Records, Retrowave.fm, Cyberpunk 2077) - Magenta-cyan grid, VHS noise, glow type
- [ ] 046 Poetic Story (Broken-Relationships Museum, Humans of New York, StoryCorps) - Sparse layout, serif italics, muted palette, long-form prose
- [ ] 047 Calm Health (One Medical, Forward Health, Headspace Health) - Soft teal, rounded inputs, friendly photos, empathetic tone
- [ ] 048 Font Showcase (Adobe Fonts, Google Fonts, MyFonts) - Dark canvas, live sliders, glyph grid, filter sidebar
- [ ] 049 Data-Art Flat (Information Is Beautiful, Flourish, Datawrapper) - Rainbow palette, playful SVG charts, interactive legend
- [ ] 050 Kinetic Type (Array-Expressive, Animography, Motionographer) - Scroll-triggered morphs, oversized mono, motion blur
- [ ] 051 Bauhaus Geometric (Bauhaus archives, Google Bauhaus, Harvard Art Museums) - Primary blocks, geometric grid, minimalist type
- [ ] 052 Swiss Typography (Helvetica specimen, Vignelli manuals, International Style posters) - Strict grid, neutral sans, objective hierarchy
- [ ] 053 Art Nouveau (Musee d'Orsay, Jugendstil posters, Tiffany & Co.) - Flowing lines, floral motifs, ornate frames
- [ ] 054 Art Deco (Jazz-Age hotels, Gatsby posters, Chrysler Building) - Geometric glamour, metallic accents, sunbursts
- [ ] 055 Constructivist (Soviet propaganda, Russian avant-garde, El Lissitzky) - Diagonal bars, red-black-white, bold sans
- [ ] 056 De Stijl (Mondrian canvases, Dutch Neoplasticism, Rietveld furniture) - Primary rectangles, thick black lines, abstract grid
- [ ] 057 Memphis Milano (Memphis Group, 80s patterns, Saved by the Bell) - Clashing hues, playful geometrics, pop squiggles
- [ ] 058 Pop Art (Warhol prints, Comic-book ads, Supreme drops) - Primary brights, halftone dots, consumer icons
- [ ] 059 Psychedelic '60s (Woodstock posters, Tie-dye merch, Jefferson Airplane) - Kaleido swirls, warped type, saturated colors
- [ ] 060 Mid-Century Modern (Palm-Springs modernism, Atomic ads, Mad Men) - Clean lines, starburst motifs, optimistic hues
- [ ] 061 Italian Futurism (Futurist manifestos, Speed-line posters, Vespa ads) - Dynamic angles, motion lines, bold italics
- [ ] 062 Grunge Aesthetic (Ray Gun mag, 1990s band sites, Urban Outfitters) - Distressed textures, torn layers, chaotic type
- [ ] 063 Punk Zine (Sniffin Glue, DIY Xerox flyers, CBGB) - Cut-out collage, ransom letters, photocopy grain
- [ ] 064 Surreal Collage (Dada art, Contemporary collagists, Adult Swim bumps) - Dreamlike juxtapositions, fragmented imagery
- [ ] 065 Maximalist (Kitsch interiors, PIN-UP spreads, Versace Casa) - Layer-upon-layer, rich textures, color clash
- [ ] 066 Baroque Ornament (Versailles decor, Grand opera houses, Dolce & Gabbana Alta Moda) - Gold scrollwork, ornate serif, classical paintings
- [ ] 067 Zen Minimalism (Muji stores, Japanese Zen gardens, Uniqlo) - Neutral earth, natural materials, tranquil space
- [ ] 068 Kawaii Pop (Sanrio, LINE Friends, Pusheen) - Cute mascots, pastels, bubbly icons
- [ ] 069 Scandinavian Modern (IKEA catalog, Nordic lifestyle, HAY Design) - Light woods, soft neutrals, functional layouts
- [ ] 070 Islamic Geometry (Mosque mosaics, Dubai Expo tiles, Alhambra Palace) - Intricate patterns, rich blues, symmetrical motifs
- [ ] 071 Afrofuturism (Diaspora sci-fi art, Sun Ra imagery, Black Panther) - Neon tech plus tribal motifs, vibrant prints
- [ ] 072 Latin Vibrance (Carnaval posters, Mexico tourism, Havaianas) - Tropical brights, folkloric patterns, festive vibe
- [ ] 073 Indian Ornate (Jaipur Lit Fest, Mughal art, Sabyasachi) - Jewel tones, mandala borders, intricate paisley
- [ ] 074 Bollywood Glam (Hindi-film promos, Music-video sets, Manish Malhotra) - Neon gradients, glamorous portraits, dramatic type
- [ ] 075 Chinese Traditional (Spring-Festival posters, Calligraphy shows, China Airlines) - Red and gold, paper-cut clouds, lucky symbols
- [ ] 076 Korean Neon (K-Pop fan cafes, Seoul nightlife, Samsung Galaxy) - Electric hues, animated stickers, techno glow
- [ ] 077 African Tribal (Afropunk art, Kente patterns, Nigerian fashion week) - Bold tribal prints, earthy and bright hues
- [ ] 078 Latin Folk (Frida crafts, Andean textiles, Anthropologie) - Vibrant warm palette, floral embroidery
- [ ] 079 Indigenous Art (Maori motifs, First-Nations patterns, Pendleton) - Sacred symbols, turquoise and terracotta, respectful tone
- [ ] 080 Mediterranean Mosaic (Greek isle tiles, Moroccan zelige, Amalfi Coast hotels) - Blue-white grid, mosaic background, arch frames
- [ ] 081 Japandi Minimalism (Scandi-Japanese interiors, &Tradition, Norm Architects) - Neutral hues, natural wood, serene balance
- [ ] 082 Boho Chic (Anthropologie, Urban Outfitters, Free People) - Layered textiles, warm earth tones, relaxed vibe
- [ ] 083 Tropical Paradise (Caribbean resort promos, Island drinks, Tommy Bahama) - Palm fronds, turquoise sea, breezy art
- [ ] 084 Flat Design (Windows 8 tiles, Pure-flat templates, Google Material 1.0) - Two-tone tiles, bright solids, icon flatness
- [ ] 085 Digital Paper Layers (Google Material demos, Gmail cards, Microsoft Fluent) - Card elevation, bold accents, tactile depth
- [ ] 086 Adaptive Hue UI (Android dynamic color, Material-You, Spotify Blend) - Auto palette, rounded modules, personal theme
- [ ] 087 Typographic Tile Grid (Metro UI hubs, News tiles, Bloomberg Terminal) - Large text blocks, vibrant solids, content-first
- [ ] 088 Skeuomorphic (Classic iOS, Aqua buttons, Real Racing 3) - Real textures, beveled controls, analog metaphors
- [ ] 089 Neomorphic (Soft-UI demos, Pale dashboards, Banking apps) - Inset shadows, subtle extrusions, pastel low-contrast
- [ ] 090 Acrylic Depth (Fluent acrylic, Vista Aero, macOS Monterey) - Frosted glass, translucency, spotlight depth
- [ ] 091 Glassmorphic (macOS Big Sur blurs, iOS panels, Windows 11) - Backdrop blur, pastel tint, floating translucency
- [ ] 092 Claymorphic (Clay-look kits, 3-D avatars, Meta Horizon) - Smooth blobs, chunky shadow, pastel palette
- [ ] 093 Soft Brutalism (Pretty brute sites, Pastel blocks, Discord Rebrand) - Raw grid, rounded corners, gentle colors
- [ ] 094 Corporate Minimalism (McKinsey portals, SaaS landings, Deloitte Digital) - White fields, muted navy, authoritative sans
- [x] 095 Abstract Workspace Pals (Corporate-Memphis illustrations, Slack, Microsoft Teams) - Geometric bendy limbs, vivid flat colors
- [ ] 096 Gradient Blast (Stripe 2018, Neon-gradient trend, Instagram Stories) - Vibrant diagonal gradient, energetic lighting
- [ ] 097 Pastel Dream (Wellness-app UIs, Feminine boards, Canva templates) - Soft pastels, organic blobs, friendly vibe
- [ ] 098 Dark-Mode Luxe (Premium EV pages, Gaming gear, Apple Pro Display) - Rich blacks, neon or gold accents, moody photos
- [ ] 099 Earthy Minimalism (Eco skincare, Sustainable cafes, Reformation) - Beige-olive palette, organic shapes, calm tone
- [ ] 100 Organic Nature (WWF, Wilderness lodges, Patagonia Provisions) - Leaf motifs, green-brown palette, wood texture
- [ ] 101 Soft-Shadow Primitives (shadcn UI, Radix plus Tailwind, Vercel Design) - Neutral grays, 1-px borders, subtle shadows
- [ ] 102 Americana Fireworks (US July-4 shows, Patriotic concerts, Ralph Lauren) - Red-white-blue bursts, star bunting, brass serif
- [ ] 103 Harvest Hearth (Thanksgiving cook sites, Autumn catalogs, Williams Sonoma) - Pumpkin palette, plaid linens, cornucopia icons
- [ ] 104 Gridiron Glow (High school football nights, Super Bowl hype, ESPN) - Turf texture, yard-line numerals, flood-light glare
- [ ] 105 Carnival Triad (New Orleans Mardi Gras, Jazz posters, Cafe du Monde) - Purple-green-gold, bead strands, confetti scroll
- [ ] 106 Desert Mirage Boho (Coachella Valley, Joshua-Tree retreats, Urban Outfitters) - Sun-bleached sand, tie-dye fade, macrame fringe
- [ ] 107 Dust Frontier (Burning-Man camps, Playa art cars, Mad Max Fury Road) - Sepia haze, LED glyphs, plywood stencil
- [ ] 108 Spectrum Pride (Pride parades, LGBTQ+ charities, Target Pride) - Six-stripe rainbow, protest placards, joyful sans
- [ ] 109 Moonlit Jack-o-Lantern (Halloween retail, Horror nights, Spirit Halloween) - Midnight violet, carved faces, slime-drip font
- [ ] 110 Freedom Jubilee (Juneteenth heritage sites, NAACP archives, Black History Museum) - Pan-African colors, kente trim, emancipation icons
- [ ] 111 Frost and Fir (Holiday tree lightings, Cozy gifts, Starbucks Holiday) - Evergreen plaid, snow dots, gingerbread script
- [ ] 112 Glacier Fjord Clean (Nordic outdoor brands, Scandinavian fintech, Visit Norway) - Icy blues, crisp air whitespace, rune icons
- [ ] 113 Shibuya Street Neon (Tokyo neon districts, Late-night malls, Blade Runner 2049) - Kanji signs, fuchsia glow, wet asphalt reflections
- [ ] 114 Carioca Samba Burst (Rio carnival promos, Tropical sandals, Corona Extra) - Feather plumes, lime-aqua fireworks, samba drums
- [ ] 115 Tuareg Dune Trail (Sahara tours, Indigo textiles, National Geographic Expeditions) - Burnt dunes, indigo cloth, kilim border
- [ ] 116 Baltic Loom Song (Baltic folk fests, Nordic choir days, Marimekko) - Linen embroidery, wood-block type, forest green
- [ ] 117 Starforge Visionary (Private rockets, Cybertruck reveals, SpaceX) - Matte charcoal, rocket schematics, audacious copy
- [ ] 118 Tidy Nest Calm (KonMari media, Minimal home blogs, The Container Store) - Soft beige grid, rounded ticks, spark-joy tone
- [ ] 119 Nature Narrator (BBC Earth docs, Wildlife portals, Planet Earth) - Moss browns, sweeping landscapes, calm serif
- [ ] 120 Sidewalk Haute Remix (Street-lux runway, Sneaker collabs, Off-White) - Helvetica caps, zip-tie red tag, safety-orange highlight
- [ ] 121 Empowerment Radiance (Oprah Daily, Wellness rebrands, Goop) - Plum-gold gradient, spotlight portrait, pull-quote script
- [ ] 122 Copper Gleam (Designer copperware, Retro trailers, West Elm) - Rose-metal gradient, brushed texture, rivet dots
- [ ] 123 Ocean Plastic Pop (Re-crafted plastic lines, Loop shoes, Adidas x Parley) - Speckled HDPE, cyan-lime pops, eco arrows
- [ ] 124 Verdant Living Wall (Interior green walls, Eco tech hubs, Bloomberg London) - Moss carpet, dew-drop gloss, carbon badge
- [ ] 125 Concrete Brutalist (Urban art spaces, Raw concrete tours, Barbican Centre) - Cool grey slabs, shutter wood grain, numeric stencil
- [ ] 126 Bamboo Whisper (Zen spa resorts, Bamboo crafts, Aman Resorts) - Pale nodes, washi texture, jade accents
- [ ] 127 Swipe-Story Stack (Ephemeral story UI, Vertical reels, TikTok) - Card carousel, gradient ring, swipe arrow
- [ ] 128 Thumb-Zone Reach (Ergonomic phone UIs, Pop-socket demos, One UI) - Lower-third controls, curved buttons, heatmap hint
- [ ] 129 Pulse Haptics (Haptic demos, Gaming headsets, PlayStation 5) - Ripple animation, micro-shadow spots, sonic blue
- [ ] 130 Floating Pill Halo (Dynamic islands, Hole-punch banners, iPhone 14 Pro) - Black pill header, depth glow, floating glyphs
- [ ] 131 Cloud-Refresh Sky (Pull-to-refresh arcs, Cloud bounce, Twitter) - Cyan arc, arrow flip, bounce puff
- [ ] 132 Capitol Archive Serif (Library of Congress digitals, Congressional records, National Archives) - Cream folio, drop-cap serif, catalog cards
- [ ] 133 Mall Gallery Exhibit (National Mall museums, Exhibit maps, Smithsonian) - Label sans, object-ID tags, slate captions
- [ ] 134 Marble Gallery Classic (British Museum halls, Artefact view, The Met) - Off-white veins, column dividers, small caps
- [ ] 135 Illuminated Codex (Medieval manuscript scans, Scriptorium, Book of Kells) - Gold-leaf borders, ornate initials, ruby seal
- [ ] 136 Silk Caravan Archive (UNESCO Silk Road, Desert museums, Marco Polo) - Sand gradient, camel art, knot border
- [ ] 137 Slate Monochrome (Mono camera sites, Dark-mode blogs, Leica) - Pure greyscale, high-contrast imagery, outline icons
- [ ] 138 Blush Millennial (Pastel DTC brands, Beauty boutiques, Glossier) - Soft salmon, rounded sans, subtle inner shadow
- [ ] 139 Neon-Lime Zest (Gen-Z resale apps, Greenroom chat, Depop) - High-lime glow, VHS noise, bold italic
- [ ] 140 Golden-Hour Ombre (Sunset gradient packs, Vacation ads, Airbnb Experiences) - Orange-violet fade, soft blur, silhouette icons
- [ ] 141 Gelato Pastel (Pastel SaaS boards, Sorbet UI kits, Notion Templates) - Mint-peach-lavender tiles, friendly avatars
- [ ] 142 Cobalt Lightning (Micromobility dash, Verify badges, Twitter Blue) - Vivid azure, lightning streak, neon edge
- [ ] 143 Antique Sepia (Vintage photo scans, Book archives, Library of Congress) - Brown wash, deckle edge, typewriter serif
- [ ] 144 Fuchsia Flash (Hot-pink telecom, Neon fashion promos, T-Mobile) - Magenta glow, sticker shapes, playful italic
- [ ] 145 Terracotta Curve (Earth-tone crafts, Outdoor lines, REI Co-op) - Umber chips, topo lines, dotted texture
- [ ] 146 Snow Quartz Frost (Nordic white tech, Ice lodges, Bose) - Pure white, frosted blur, ultra-light sans
- [ ] 147 Pastel Islandcraft (Cozy-island sims, Pastel cottage games, Animal Crossing) - Soft cube grass, pastel wood, leaf icon
- [ ] 148 Pop Royale Rush (Party-bean battle games, Hero drop zones, Fall Guys) - Cel-shade heroes, comic wow burst, dancing emotes
- [ ] 149 Astral Impostor (Crew-bean space games, Deception clones, Among Us) - Dark star field, emergency red, bubbly mono
- [ ] 150 Chrome Hero Forge (Neon hero shooters, Ability grids, Overwatch) - Neon edge light, gradient HP bars, hero portraits
- [ ] 151 Runic Tarnish (Souls-like epics, Gothic ARPGs, Elden Ring) - Gold on soot-black, cracked serif, mist swirl
- [ ] 152 Teal Visor HUD (Sci-fi visor UIs, Exo cockpits, Minority Report) - Teal hologram, visor frame, radar sweep
- [ ] 153 Turbo Neon Racer (Car-ball stadium, Drift arena, Rocket League) - Neon trail, stadium LEDs, techno italic
- [ ] 154 Arcade Pixel KO (Retro fighter cabinets, Classic sprites, Street Fighter) - Pixel KO, sprite grid, quarter-circle arrow
- [ ] 155 Bright Beast Quest (Monster-catch RPGs, Digi tamer sims, Pokemon) - Candy-bright creatures, capture roundels, grass gradient
- [ ] 156 Red-Packet Rush (Temu, Taobao, Wish) - Flash-sale orange, hongbao icons, timer bursts, stacked coupons
- [ ] 157 Geek-Blue Aisle (Best Buy, Newegg, B&H Photo) - Royal-blue bars, yellow tags, spec grids, circuit icons
- [ ] 158 Chrome and Rebel (Harley-Davidson, Indian Motorcycle, Chrome Hearts) - Matte black steel, chrome, skull badge, slab stencil
- [ ] 159 Purple Reign Court (LA Lakers, LA Sparks, Sacramento Kings) - Purple-gold gradient, star sparkles, jersey numerals
- [ ] 160 Flamingo Side Net (Inter Miami CF, Palermo FC, Victorias Secret Pink) - Neon pink and black, palm shadows, crest glow
- [ ] 161 Wing-Voltage (Red Bull, Monster, 5-hour Energy) - Electric slashes, wing icon, metallic energy can
- [ ] 162 Trailhead Evergreen (REI, MEC, Arcteryx) - Forest topography, rugged serif, backpack icons
- [ ] 163 Moonwave Calm (Calm, Headspace, Ten Percent Happier) - Indigo gradient, sine wave, crescent moon
- [ ] 164 Rainbow Giggle-Tunes (CoComelon, Baby Shark, Disney Junior) - Crayon rainbow, bubbly font, smiling mascots
- [ ] 165 Orange Apron DIY (The Home Depot, B&Q, Lowes) - Construction orange, blueprint grid, tool pictograms
- [ ] 166 Capsule Nordic (Uniqlo, COS, Everlane) - Milk-white canvas, tidy cubes, crisp sans
- [ ] 167 Patchwork Viva (Desigual, Missoni, Anthropologie) - Kaleido knits, mosaic stripes, stitch doodles
- [ ] 168 Emerald Fizz (Perrier, San Pellegrino, Sprite) - Bottle green, rising bubbles, citrus spark
- [ ] 169 Sky-Saver Jet (Ryanair, easyJet, Southwest) - Sky-blue panels, fuselage bands, fare stickers
- [ ] 170 Rescue-Peak Red (Mammut, Ortovox, Mountain Rescue) - Snow white, rescue red, peak contour map
- [ ] 171 Violet Wallet Wave (Nubank, Wise, Revolut) - Royal violet, minimal cards, neo-sans numerals
- [ ] 172 Safaripay (M-Pesa, Airtel Money, Venmo Africa) - Savanna green, feature-phone frame, SMS ticker
- [ ] 173 Jade Super-Ride (Grab, Gojek, Uber Green) - Jade gradient, scooter avatars, live ETA chip
- [ ] 174 Arrow-Parcel Pulse (DHL, Correos, FedEx) - Sun-yellow canvas, red arrow stripe, route lines
- [ ] 175 Crimson Fan-Market (Rakuten, Mercari, Yahoo Auctions Japan) - Red sun disk, kana headline, pixel tiles
- [ ] 176 Teal Velocity (AMG Petronas F1, INEOS Grenadiers, Aston Martin F1) - Teal streaks, brushed silver, telemetry digits
- [ ] 177 Iberian Flash-Vogue (Zara, Mango, Massimo Dutti) - Editorial portrait, slab caps, rapid carousel
- [ ] 178 Dewdrop K-Glow (Laneige, Innisfree, Glow Recipe) - Dew gradient, porcelain pastel, glazed buttons
- [ ] 179 Helvetic Chrono (Rolex, Omega, Swatch) - Sunburst dials, gilt indices, forest leather
- [ ] 180 Breaker Surf Pop (Billabong, Rip Curl, Vans) - Coral sunset, palm cutouts, wax swirl
- [ ] 181 Chai-Street Spice (Chaayos, Chai Point, Starbucks Teavana) - Saffron cardamom, clay-cup badge, paisley steam
- [ ] 182 Selva Verde (Natura & Co, O Boticario, The Body Shop) - Rain-forest green, acai purple, eco stamp
- [ ] 183 Oat-Ink Quirk (Oatly, Minor Figures, NotMilk) - Off-white cartons, hand-ink headlines, oat icons
- [ ] 184 Warehouse Pulse (Berghain, Ableton, Boiler Room) - Charcoal gradient, strobe stripe, mono labels
- [ ] 185 Macaron Royale (Laduree, Pierre Herme, Magnolia Bakery) - Pastel shells, gold filigree, cursive monogram
- [ ] 186 Spice-Tile Bazaar (Mavi, Grand Bazaar Istanbul, World Market) - Cobalt tiles, brass tassels, Ottoman serif
- [ ] 187 Azulejo Coast (Vista Alegre, Bordallo, CB2) - Blue-white grid, ceramic crackle, rope border
- [ ] 188 Tweed and Heather (Harris Tweed, Barbour, Ralph Lauren) - Fog plaid, wax cotton, brass snap, stag crest
- [ ] 189 Black Fern Legend (New Zealand All Blacks, Silver Ferns, Air New Zealand) - Pitch black, silver fern, haka blur
- [ ] 190 Maple Heritage Stripe (Roots, Hudsons Bay, Tim Hortons) - Buffalo plaid, heritage stripe, maple badge
- [ ] 191 Amber Brauhaus (Paulaner, Hofbrau, Oktoberfest) - Blue-white diamonds, amber froth, brass tuba
- [ ] 192 Jade-Chat Hub (WeChat, Alipay, LINE) - Jade gradient, QR halo, mini-app icons
- [ ] 193 Panda Courier Dash (Meituan Waimai, Ele.me, DoorDash) - Yellow panda, bag sticker, route confetti
- [ ] 194 Lime-Ride Flow (Bolt, Lime, Bird) - Neon lime header, dark map, ride bubble
- [ ] 195 Gaelic Malt Gold (Jameson, Bushmills, Johnnie Walker) - Bottle green, gold crest, barley sketch
- [ ] 196 Tropi-Fizz Pop (Guarana Antarctica, Inca Kola, Fanta) - Lime fizz, jungle leaf, retro script
- [ ] 197 Aurora Flux (Hurtigruten, Philips Hue, Northern Lights Tours) - Prismatic ribbon gradient, deep indigo sky, slow shimmer, meteor-line motion
- [ ] 198 Diffusion Dreamscape (Midjourney, Runway ML, Adobe Firefly) - Soft-noise texturing, painterly sweeps, latent blur, surreal object morphs
- [ ] 199 Fold-Future Canvas (Samsung Galaxy Z Fold, Motorola Razr+, Microsoft Surface Duo) - Crease-edge glow, overlapping glass panels, hover hinge, split-screen card flow
- [ ] 200 Zero-Carbon Horizon (Tesla Solar Roof, Rivian R1T, Beyond Meat) - Matte graphite, neon-lime battery bar, sunrise orange accent, net-zero badge
