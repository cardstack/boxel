import Route from '@ember/routing/route';
import { service } from '@ember/service';

import MatrixService from '../services/matrix-service';
import CardService from '../services/card-service';
import RouterService from '@ember/routing/router-service';

export default class Application extends Route<void> {
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @service private declare router: RouterService;
  async beforeModel(): Promise<void> {
    await this.matrixService.ready;
    await this.matrixService.start();
    debugger;
    // if (this.matrixService.isLoggedIn) {
    //   // get a default realm
    //   // transition to the index card of that realm with operator mode enabled and workspace chooser open
    //   let realm = this.cardService.userRealms[0];
    //   // let card
    //   // let indexCard = await this.cardService.getCard();
    //   // todo load card
    //   this.router.transitionTo('card', `index`, {
    //     queryParams: {
    //       card: `${realm}index`,
    //       operatorModeEnabled: 'true',
    //       workspaceChooserOpened: 'true',
    //     },
    //   });
    // }
  }
}
