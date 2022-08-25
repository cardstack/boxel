import { module, test, skip } from "qunit";
import { ModuleSyntax } from "@cardstack/runtime-common/module-syntax";
import "@cardstack/runtime-common/helpers/code-equality-assertion";

module("module-syntax", function () {
  test("can get the code for a card", async function (assert) {
    let src = `
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `;

    let mod = new ModuleSyntax(src);
    assert.codeEqual(mod.code(), src);
  });

  test("can add a field to a card", async function (assert) {
    let src = `
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `;

    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: "exportedName", name: "Person" },
      "age",
      {
        module: "https://cardstack.com/base/integer",
        name: "default",
      },
      "contains"
    );

    assert.codeEqual(
      mod.code(),
      `
      import IntegerCard from "https://cardstack.com/base/integer";
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field age = contains(IntegerCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `,
      "card src is correct"
    );

    let card = mod.possibleCards.find((c) => c.exportedAs === "Person");
    let field = card!.possibleFields.get("age");
    assert.ok(field, "new field was added to syntax");
    assert.deepEqual(
      field?.card,
      {
        type: "external",
        module: "https://cardstack.com/base/integer",
        name: "default",
      },
      "the field card is correct"
    );
    assert.deepEqual(
      field?.type,
      {
        type: "external",
        module: "https://cardstack.com/base/card-api",
        name: "contains",
      },
      "the field type is correct"
    );
    assert.deepEqual(
      field?.decorator,
      {
        type: "external",
        module: "https://cardstack.com/base/card-api",
        name: "field",
      },
      "the field decorator is correct"
    );

    // TODO add another field which will assert that the field path is correct
    // (since the new field must go after this field)
  });

  skip("can add a field to a card that doesn't have any fields");

  // TESTS:
  // containsMany
  // computed (?)
  // test fieldCard declaration collisions
  // test fieldCard declaration reuse
  // fieldName collisions
  // fieldName collision with parent card
});
