import { CardDef, containsMany, linksTo } from 'card-api';

class CommandValidationError extends Error {
  constructor(
    message: string,
    public details: Record<'fields', string[]>,
  ) {
    super(message);
  }
}

class CommandDef extends CardDef {}

export class RedactLinksByRealm extends CommandDef {
  @linksTo(CardDef, { commandInput: true, required: true })
  declare targetCard: CardDef;
  @containsMany(RealmField, { commandInput: true })
  declare allowedRealms: RealmField[];
  @containsMany(RealmField, { commandInput: true })
  declare disallowedRealms: RealmField[];

  validate() {
    if (this.allowedRealms && this.disallowedRealms) {
      throw new CommandValidationError(
        'Cannot specify both allowedRealms and disallowedRealms',
        {
          fields: ['allowedRealms', 'disallowedRealms'],
        },
      );
    }
    if (!this.allowedRealms && !this.disallowedRealms) {
      throw new CommandValidationError(
        'Must specify either allowedRealms or disallowedRealms',
        {
          fields: ['allowedRealms', 'disallowedRealms'],
        },
      );
    }
    return true;
  }

  async perform() {
    // Create an in-memory copy of the targetCard
    // Iterate over all the linksTo and linksToMany fields of the copy
    // and remove any that are not allowed based on allowedRealms/disallowedRealms.
    //
    // Return the redacted copy of the card.
  }
}

export class Upcast extends CommandDef {
  @linksTo(CardDef, { commandInput: true, required: true })
  declare sourceCard: CardDef;
  @contains(CodeRef, { commandInput: true, required: true })
  declare targetClass: CodeRef;

  validate() {
    if (!this.targetClass.isSubclassOf(this.sourceCard)) {
      throw new CommandValidationError(
        'targetClass must be a subclass of sourceCard',
        {
          fields: ['sourceCard', 'targetClass'],
        },
      );
    }
    return true;
  }

  async perform() {
    // load the targetClass
    // assert that the targetClass is a subclass of the sourceCard's class
    // Create a new instance of the targetClass
    // Copy all the fields from the sourceCard to the new instance
    // Return the new instance
  }
}

export ExtractFieldByName extends CommandDef {
  @linksTo(CardDef, { commandInput: true, required: true }) declare sourceCard: CardDef;
  @contains(StringField, { commandInput: true, required: true }) declare sourceFieldName: StringField;
  @contains(FieldDef, { commandInput: true, required: true })
  declare sourceField: FieldDef;
  @contains(CodeRef, { commandInput: true, required: true })
  declare targetClass: CodeRef;

  validate() {
    if (!this.sourceCard.contains(this.sourceField)) {
      throw new CommandValidationError(
        'sourceField must be a field of sourceCard',
        {
          fields: ['sourceCard', 'sourceField'],
        },
      );
    }
    return true;
  }

  async perform() {
    // load the targetClass
    // Create a new instance of the targetClass
    // Copy the value of the sourceField from the sourceCard to the new instance
    // Return the new instance
  }
}
