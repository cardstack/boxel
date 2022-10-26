import { contains, linksTo, field, Card } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class Friend extends Card {
  @field firstName = contains(StringCard);
  @field friend = linksTo(() => Friend);
}
