import { Component, primitive, serialize, Card, CardInstanceType, CardConstructor } from './card-api';

export interface ExportedCardRef {
  module: string
  name: string
}

export default class CardRefCard extends Card {
  static [primitive]: ExportedCardRef;
  
  static [serialize](cardRef: ExportedCardRef) {
    return {...cardRef}; // return a new object so that the model cannot be mutated from the outside
  }
  static fromSerialized<T extends CardConstructor>(this: T, cardRef: ExportedCardRef): CardInstanceType<T> {
    return {...cardRef} as CardInstanceType<T>;// return a new object so that the model cannot be mutated from the outside
  }

  // TODO  Probably we'll want to enhance these templates, like render the card
  // that the card ref is pointing to in an embedded format
  static embedded = class Embedded extends Component<typeof this> {
    <template>Module: {{@model.module}} Name: {{@model.name}}</template>
  }
  static isolated = class Isolated extends Component<typeof this> {
    <template>Module: {{@model.module}} Name: {{@model.name}}</template>
  }
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends Component<typeof this> {
    <template>Module: {{@model.module}} Name: {{@model.name}}</template>
  }

}