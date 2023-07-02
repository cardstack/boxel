import Service, { service } from '@ember/service';

import type CardService from './card-service';
import type {
    Card,
} from 'https://cardstack.com/base/card-api';
import ENV from '@cardstack/host/config/environment';

// Set the url like this
const { ownRealmURL } = ENV;

export default class AiService extends Service {
    @service declare cardService: CardService;


    public async getChanges(
        card: Card,
        request: string
    ): Promise<Map<string, string>> {
        let fields = await this.cardService.getFields(card);
        for (let fieldName of Object.keys(fields)) {
            console.log(fieldName, (card as any)[fieldName]);
        }
        console.log(fields);
        let cardData = this.cardService.api.serializeCard(card);
        const response = await fetch('http://localhost:8000/contentChange', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            duplex: 'half',
            body: JSON.stringify({
                userChangeRequest: request,
                card: cardData,
            }),
        });
        const data = await response.json();
        return data.data;
    }

}
