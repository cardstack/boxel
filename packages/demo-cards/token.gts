import { contains, field, linksTo } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";
import { Chain } from "./chain";
import { Asset } from "./asset";

export class Token extends Asset {
  @field chainId = linksTo(Chain);
  @field address = contains(StringCard);
}
