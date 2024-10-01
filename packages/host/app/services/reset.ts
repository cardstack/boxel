import Service from '@ember/service';

interface Resettable {
  resetState(): void;
}

export default class ResetService extends Service {
  private resettables: Resettable[] = [];

  register(resettable: Resettable) {
    this.resettables.push(resettable);
  }

  resetAll() {
    for (let resettable of this.resettables) {
      resettable.resetState();
    }
  }
}
