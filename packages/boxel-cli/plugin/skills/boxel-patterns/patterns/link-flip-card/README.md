---
validated: source-proven
---

# link-flip-card — CSS-only front/back flip primitive

**What this gives you:** A two-sided card that flips on click with a smooth 3D rotation. One `@tracked` boolean drives a class toggle; CSS does everything else. Zero JS in the animation itself.

**When to use:** Flashcards, study aids, product reveals (front: photo, back: specs), brand-mark cards (front: logo, back: bio), tarot/oracle decks, any two-sided info card. Anywhere the "second side" content is naturally hidden and revealing it is part of the interaction.

**The insight:** The card has three nested elements with specific CSS roles:

1. **Outer container** — `perspective: 1200px` puts the camera. Smaller numbers are more dramatic.
2. **Inner element** — `transform-style: preserve-3d` keeps the two faces in true 3D space relative to each other, then rotates on the Y-axis when the flip class is set.
3. **Two face elements** — `backface-visibility: hidden` hides each face when it's rotated away from the camera. The **back face is pre-rotated 180deg** so it sits behind the front. When the inner rotates 180deg, the back lands facing the camera.

The whole `.gts` is almost trivial — the recipe is in the CSS.

## Recipe shape

```ts
static isolated = class Isolated extends Component<typeof Flashcard> {
  @tracked isFlipped = false;
  flip = () => { this.isFlipped = !this.isFlipped; };

  <template>
    <div class='flip-container {{if this.isFlipped "is-flipped"}}'
         role='button' tabindex='0'
         {{on 'click' this.flip}} {{on 'keydown' this.flip}}>
      <div class='flip-inner'>
        <div class='face front'>{{@model.front}}</div>
        <div class='face back'>{{@model.back}}</div>
      </div>
    </div>
  </template>
};
```

```css
.flip-container { perspective: 1200px; }
.flip-inner {
  transform-style: preserve-3d;
  transition: transform 0.55s cubic-bezier(0.4, 0, 0.2, 1);
}
.is-flipped .flip-inner { transform: rotateY(180deg); }
.face {
  position: absolute; inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.back { transform: rotateY(180deg); }
```

## Gotchas

- **`transform-style: preserve-3d` does NOT inherit.** Every layer between the perspective ancestor and the rotated element must declare it, or children flatten to 2D.
- **Without `backface-visibility: hidden`** you see mirrored text bleeding through the front face mid-rotation. The `-webkit-` prefix is still needed for older Safari.
- **The back face needs `transform: rotateY(180deg)`** so when the container rotates, it lands facing the camera. Forgetting this produces a "flip to a blank wall" effect.
- **Pointer / keyboard parity** — make the container `role='button'` + `tabindex='0'` + listen for both `click` and `keydown` so the card is accessible.
- **Beware nested transforms.** If the parent grid/list adds its own `transform`, it can create a new stacking context that breaks the perspective on the child. Test inside the actual list, not just in isolation.

## Source

- `realms-staging.stack.cards/ctse/vague-leopon/10-flashcard-deck/flashcard.gts` — full Flashcard CardDef including the isolated flip, an embedded preview, and a CQ-compliant fitted layout. The flip lives at lines 31–230.

## See also

- `link-view-transition` — for whole-card morphs between unrelated states (not a fixed front/back pair).
- `format-morph-shared-component` — one component, multiple formats — useful when "the back" is actually the edit view.
- `boxel-ui-guidelines/references/template-patterns.md` — entrance animation and CSS budget guidance.
