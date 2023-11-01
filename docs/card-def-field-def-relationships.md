# CardDef and FieldDef Relationships

**A primitive field** is a field that not have any fields of its own. The `StringField`, `NumberField`, or `BooleanField` classes provided by the `card-api` are examples of primitive fields.

**A compound field** (also called **composite field**) is a field that has other fields. An example is a _Author_ field with _firstName_ and _lastName_ fields.

## 1- Primitive and compound field (singular) contained in FieldDef (`contains`)

```typescript
class PhoneField extends FieldDef {
  // primitive field contained in FieldDef
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field extension = contains(NumberField);
}
```

// Example 1a

In the `PhoneField` class above, _country_, _area_, and _extension_ fields are each primitive fields because `NumberField` is a primitive field definition. They are the fields of `PhoneField` field definition.

```typescript
class EmergencyContactField extends FieldDef {
  // primitive field contained in FieldDef
  @field name = contains(StringField);

  // compound field contained in FieldDef
  @field phoneNumber = contains(PhoneField);
}
```

// Example 1b

The `EmergencyContactField` field definition contains one primitive field (_name_), and one compound field (_phoneNumber_). The _phoneNumber_ field contains the _PhoneField_ `FieldDef`.

When rendered in `edit` format, primitive and compound fields contained in a `FieldDef` appear _vertically_ by default, where the field label appears above its input in the UI. The fields are editable.

## 2- Primitive and compound field (singular) contained in CardDef (`contains`)

```typescript
class ContactField extends CardDef {
  // primitive field contained in CardDef
  @field firstName = contains(StringField);

  // compound field contained in CardDef
  @field emergencyContact = contains(EmergencyContactField);
}
```

// Example 2

When rendered in `edit` format, primitive and compound fields contained in a `CardDef` appear _horizontally_ by default, where the field label appears to the left of its input in the UI. The fields are editable.

The fields nested inside the _emergencyContact_ field will render vertically, as expected from a field contained in a `FieldDef`.

## 3- Primitive field (plural) contained in FieldDef (`containsMany`)

```typescript
class EmergencyContactField extends FieldDef {
  // primitive field contained in FieldDef (singular)
  @field email = contains(StringField);

  // primitive field contained in FieldDef (plural)
  @field alternativeEmails = containsMany(StringField);
}
```

// Example 3

Whereas a singular primitive `FieldDef` is editable in edit format, a primitive `containsMany` field definition is read-only when rendered inside another `FieldDef`.

## 4- Compound field (plural) contained in FieldDef (`containsMany`)

Whereas a singular `FieldDef` is editable in edit format, the `containsMany` field definition is read-only, when rendered inside another `FieldDef`. The read-only `containsMany` renders in the `atom` format for a compound field. For this, it is necessary to either provide an `atom` template, or provide a `title` field in the field definition. This is because the default atom template uses the `title` field to render, if there isn't a custom atom template available.

```typescript
class PhoneField extends FieldDef {
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field number = contains(NumberField);

  // providing a `title` is necessary to render the default atom template
  @field title = contains(StringField, {
    computeVia: function (this: PhoneField) {
      return `(+${this.country}) ${this.area}-${this.number}`;
    },
  });
}

class EmergencyContactField extends FieldDef {
  // compound field contained in FieldDef (singular)
  @field phoneNumber = contains(PhoneField);

  // compound field contained in FieldDef (plural)
  @field alternativePhoneNumbers = containsMany(PhoneField);
}
```

// Example 4

## 5- Primitive or compound field (plural) contained in CardDef (`containsMany`)

In the example below, `emails` is a primitive `containsMany` field in `ContactCard` card, and `phoneNumbers` is a compound `containsMany` field in the same card. In edit format, these top level fields are editable.

The `alternativeEmails` and `alternativePhoneNumbers` fields in `EmergencyContactField` field definition are nested `containsMany` fields, and are read-only fields, as seen in items (3) and (4) above.

```typescript
  class PhoneField extends FieldDef {
    static displayName = 'Phone Number';

    @field country = contains(NumberField);
    @field area = contains(NumberField);
    @field number = contains(NumberField);

    // this provides a custom atom template layout
    static atom = class AtomTemplate extends Component<typeof this> {
      <template>
        (+<@fields.country />) <@fields.area />-<@fields.number />
      </template>
    };
  }

  class EmergencyContactField extends FieldDef {
    @field name = contains(StringField);
    @field email = contains(StringField);
    @field alternativeEmails = containsMany(StringField);
    @field phoneNumber = contains(PhoneField);
    @field alternativePhoneNumbers = containsMany(PhoneField);
  }

  class ContactCard extends CardDef {
    // primitive field contained in CardDef (singular)
    @field firstName = contains(StringField);

    // primitive field contained in CardDef (plural)
    @field emails = containsMany(StringField);

    // compound field contained in CardDef (plural)
    @field phoneNumbers = containsMany(PhoneField);

    // compound field contained in CardDef (singular)
    @field emergencyContact = contains(EmergencyContactField);
  }
```

// Example 5a, 5b, 5c

## 6- CardDef field (singular) linked to from FieldDef (`linksTo`)

## 7- CardDef field (plural) linked to from FieldDef (`linksToMany`)

## 8- CardDef field (singular) linked to from CardDef (`linksTo`)

## 9- CardDef field (plural) linked to from CardDef (`linksToMany`)
