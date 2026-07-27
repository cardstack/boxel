# Print and published output

Printed and host-mode pages cross boundaries that ordinary scoped card CSS does not: browser print settings can suppress backgrounds, and the host can wrap a card in fixed-height containers that clip later pages. Treat print as its own output format and verify the generated PDF in more than one browser engine when color carries meaning.

## Unclip host wrappers for multi-page print

Host mode can place the isolated card inside viewport-height wrappers with `overflow: hidden` or `auto`. Scoped card CSS cannot reliably reset ancestors outside the card. Add a deliberately unscoped print-only style alongside the normal scoped style:

```css
@media print {
  html,
  body,
  .host-mode-content,
  .host-mode-card,
  .field-component-card,
  .boxel-card-container,
  .current-card {
    display: block !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }
}
```

This is a narrow exception to the normal scoped-style rule. Keep every selector inside `@media print` and limit it to the host wrappers that must release pagination.

## Do not encode meaning only in CSS backgrounds

Print dialogs commonly disable background graphics. Important calendar marks, legends, swatches, or status shapes should use inline SVG geometry with explicit `fill`, not only `background-color`, gradients, borders, or shadows. `print-color-adjust: exact` is a preservation hint, not a replacement for semantic SVG marks.

Firefox can require print-specific fill selectors even when the SVG elements are present:

```css
@media print {
  .print-page .mark-fill-primary {
    fill: var(--primary) !important;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    forced-color-adjust: none;
  }
}
```

Use the same SVG shapes in the content and legend. If adjacent printed cells have gaps, size the mark to cover the intended printed region rather than relying on preserved SVG aspect ratio.

## Validation

1. Confirm all print-only pages exist in the DOM.
2. Generate a PDF with background graphics disabled.
3. Verify page count, clipping, semantic colors, and legend parity.
4. Check at least Chromium and Firefox when SVG color is essential.
5. After changing a CardDef that feeds host-mode prerendered HTML, reindex before publishing; otherwise a public page can continue serving stale HTML.

See `boxel-file-def/references/using-filedef-in-cards.md` and `link-host-mode-paths` for public asset URLs in raw `<img>` elements.
