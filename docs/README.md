
# Documentation about Boxel

## Prerequisites

The following VS Code addon helps to visualize a .mermaid file: https://marketplace.visualstudio.com/items?itemName=tomoyukim.vscode-mermaid-editor

It also has a feature to save an .svg image, which be opened in Chrome for a decent pan and zoom experience.

## Concepts

The following are important concepts: 

- [Card and Field Definition Relationships](card-def-field-def-relationships.md): There is a subtle distinction between card and fields to consider when creating cards. 
- [Inheritance](card-inheritance.md): Cards can be extended based upon user's custom needs -- no reinventing the wheel.  
- [Rendering](card-rendering.md): Cards can be rendered easily in the browser. Each card renders differently based upon how it is related and what context it exists in.  
- [Serialization and Deserialization](card-serialization-deserialization.md): Cards have to be adapted to a consistent JSON format before being sent over-the-wire to other consumers.
- [Computed Fields](computed-fields.md): Computed fields work too! We can compute on the data that is already contained in a card to build more complex logic.   
- [Indexing](indexing.md): Indexing powers the re-rendering of cards when it's dependencies get updated. 
- [Realm](realm.md): Realms are storage for cards that have their own underlying permissions and indexer.
- [Search](search.md): Every Card is searchable within and across realms.