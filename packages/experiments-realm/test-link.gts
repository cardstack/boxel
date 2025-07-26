import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component, field, linksTo } from 'https://cardstack.com/base/card-api';


export class Consumee extends CardDef {
  static displayName = 'Consumee'
}

export class Consuming extends CardDef {
  static displayName = "Consuming";
  @field consumee = linksTo(Consumee)
}