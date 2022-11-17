import { contains, field, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';

export class PaymentMethod extends Card {
  @field currency = contains(StringCard);
  @field logo = contains(StringCard);
  @field exchangeRate = contains(IntegerCard);
}