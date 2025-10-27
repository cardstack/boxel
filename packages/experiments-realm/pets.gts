import {
  CardDef,
  Component,
  StringField,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import enumField, { enumConfig } from 'https://cardstack.com/base/enum';
import CatIcon from '@cardstack/boxel-icons/cat';
import DogIcon from '@cardstack/boxel-icons/dog';
import BirdIcon from '@cardstack/boxel-icons/bird';
import PawPrintIcon from '@cardstack/boxel-icons/paw-print';

// Fun example: pets with an enum-backed species field and an owner that
// provides per-instance options via configuration.

// A simple enum field with rich options, including an explicit null option
// for “Mystery”.
export const SpeciesField = enumField(StringField, {
  options: [
    { value: 'cat', label: 'Cat', icon: CatIcon },
    { value: 'dog', label: 'Dog', icon: DogIcon },
    { value: 'parrot', label: 'Parrot', icon: BirdIcon },
    { value: null, label: 'Mystery', icon: PawPrintIcon },
  ],
  displayName: 'Species',
});

export class Pet extends CardDef {
  @field name = contains(StringField);
  @field species = contains(SpeciesField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='pet-card'>
        <strong>{{@model.name}}</strong>
        <span class='species'>
          <@fields.species @format='atom' />
        </span>
      </div>
      <style scoped>
        .pet-card {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }
        .species {
          color: var(--boxel-700);
        }
      </style>
    </template>
  };
}

// PetOwner demonstrates usage-level configuration: allowed species is
// authored per-owner, and preferredSpecies enum options come from that list.
export class PetOwner extends CardDef {
  @field name = contains(StringField);
  @field allowedSpecies = containsMany(StringField);
  @field preferredSpecies = contains(SpeciesField, {
    configuration: enumConfig((self: PetOwner) => ({
      enum: { options: self.allowedSpecies, unsetLabel: 'Pick a pal…' },
    })),
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='owner-card'>
        <strong>{{@model.name}}</strong>
        <div class='meta'>
          Allowed: {{@model.allowedSpecies}}
        </div>
        <div>
          Preferred: <@fields.preferredSpecies @format='atom' />
        </div>
      </div>
      <style scoped>
        .owner-card { display: grid; gap: 0.25rem; }
        .meta { color: var(--boxel-700); font-size: 0.9em; }
      </style>
    </template>
  };
}

// Inheritance substitution example: a base card with a primitive StringField
// that a subclass overrides with an enum built on StringField.
export class BaseTask extends CardDef {
  @field title = contains(StringField);
  @field priority = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='task-card'>
        <strong>{{@model.title}}</strong>
        <span>Priority: {{@model.priority}}</span>
      </div>
    </template>
  };
}

const PriorityEnumField = enumField(StringField, {
  options: ['High', 'Medium', 'Low'],
  displayName: 'Priority',
});

export class AppTask extends BaseTask {
  // Override priority with an enum based on StringField
  @field priority = contains(PriorityEnumField, {
    configuration: enumConfig({ enum: { unsetLabel: 'Choose…' } }),
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='task-card'>
        <strong>{{@model.title}}</strong>
        <span>
          Priority: <@fields.priority @format='atom' />
        </span>
      </div>
    </template>
  };
}
