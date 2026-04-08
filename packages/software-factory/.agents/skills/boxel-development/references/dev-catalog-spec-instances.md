# Catalog Spec Card Instances

For each top-level card definition, create a Catalog Spec card instance in the target realm's `Spec/` folder using the `create_catalog_spec` tool. This makes the card discoverable in the Boxel catalog.

The `create_catalog_spec` tool has the authoritative JSON schema for Spec card fields — use its parameter definitions to know which attributes and relationships are available. The tool auto-constructs the document with the correct `adoptsFrom` (`https://cardstack.com/base/spec#Spec`).

## Usage

Use the `create_catalog_spec` tool to create a Spec card. The tool's parameters define the available fields dynamically from the card definition — consult the tool schema for the exact field names and types.

Key concepts:

- `ref` — a CodeRef pointing to the card definition (module path + exported class name). The module path is relative from the Spec card to the `.gts` file (e.g., `../sticky-note` from `Spec/sticky-note.json`).
- `specType` — `"card"` for CardDef, `"field"` for FieldDef, `"component"` for standalone components.
- `linkedExamples` — a relationship pointing to sample card instances. Create at least one sample instance and link it here.

## Sample Card Instances

Create at least one sample instance with realistic data for each top-level card. Sample instances serve as both catalog examples and test fixtures.

Place sample instances in a folder named after the card type (e.g., `StickyNote/welcome-note.json`). Use `write_file` to create them. The `linkedExamples` relationship in the Spec card points to these using a relative path (e.g., `../StickyNote/welcome-note`).
