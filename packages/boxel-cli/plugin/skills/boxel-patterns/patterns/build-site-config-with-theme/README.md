---
validated: source-proven
---

# build-site-config-with-theme — Site registry with ThemeCard brand guide

**What this gives you:** A reusable site-level configuration card that owns the brand theme, navigation page registry, and primary/secondary CTAs for a multi-page Boxel site or app.

**When to use:** Marketing sites, product microsites, documentation portals, multi-page app shells, or any card family where multiple pages should share one nav model and one brand theme.

**The insight:** Treat site settings as data. `SiteConfig` links to a `ThemeCard` brand guide and to a set of page registry cards. Page shells then compute `cardTheme` from `site.brandGuide`, while `cardInfo.theme` remains the per-instance override.

**Recipe shape:**

```ts
export class PageConfig extends CardDef {
  @field pageId = contains(StringField);
  @field pageLabel = contains(StringField);
  @field pageUrl = contains(UrlField);
  @field showInNav = contains(BooleanField);
  @field navOrder = contains(NumberField);
}

export class SiteConfig extends CardDef {
  @field brandGuide = linksTo(() => ThemeCard);
  @field pages = linksToMany(() => PageConfig);
}
```

**Gotchas:**

- For production realm files, keep `PageConfig`, `SiteConfig`, and each page shell in separate `.gts` files. The example co-locates them only to show the pattern in one place.
- Preserve `cardInfo.theme` as the override in computed `cardTheme`: `this.cardInfo?.theme ?? this.site?.brandGuide ?? null`.
- Sort nav entries in the rendering component, not in the JSON instance. Use `showInNav` + `navOrder`.
- This pattern is about site-wide state. Individual page content should still live in page or section cards.

**Source:** `realms-staging.stack.cards/ctse/copper-cleft/site-config.gts:15-42`, `components/site-navbar.gts:114-146`, `BSL-STUDY.md:656-660`.

**See also:** `theme-first-workflow`, `cardinfo-override-title`, `app-card-home-with-search`.
