# Card Inheritace

Every card type inherits from another card type. Any card can be inherited from.

The mechanism used is [standard prototypal inheritance as implemented in JavaScript/Typescript](https://www.typescripttutorial.net/typescript-tutorial/typescript-inheritance/). Our serialization approach of serializing computeds makes upcasting easy. Our UI should not force a user who doesn't know about inheritance to grapple with it to make simple changes.

# Card Inhertance in Action

If someone makes a brand-new blank card, it inherits from the built-in "base card" which is the most minimal form a card can take. If someone creates an awesome card to showcase a product for their business, and they wanted to make more cards like it, they could inherit from that product card. All the cards that inherit from the product card use its schema, templates, and more by default.

When a card inherits from another card, fields in its schema cannot be deleted or modified. but new fields may be added. In addition, features like visual appearance, JavaScript behavior, and more can be overridden as needed.

To give an example, if the original product card's isolated template changes, so does the isolated on the new card. But, the new card could also be edited to have an isolated component that is different than the card it inherited from. Each card also still holds its own unique data like the values for a title, description, etc.

## The Inheritance Chain

Cards maintain their connection to where they were inherited from, all the way up the chain.

For example, if you created a chain of three card types that inherit from one another, and changed the "grandparent" card type's templates, you would see those changes flow through the other cards.

## Adoption

We use the term adoption to describe a card being an instance of a particular card type. TODO: Accept, Suggest, Prefer language; Avoid downcast/upcast.

## Overriding Fields

A card type inheriting from another card type can override zero or more fields. A simple example of this is a Person card type inheriting from the Base Card type. The Person type adds new fields for `firstName` and `lastName` and overrides the `title` field to be a computed that returns the full name of the person. When overriding a field with a computed, we plan to require a developer to provide a setter as well, so that the parent type's contract of the `title` field being readable and writeable is not broken. In order to avoid confusion, the default edit template will not include edit controls for computed fields.
