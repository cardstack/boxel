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
