import { contains, field, Card } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";
import SillyNumberCard from "./silly-number";

export class Dog extends Card {
  @field firstName = contains(StringCard);
  @field numberOfTreats = contains(SillyNumberCard);
}