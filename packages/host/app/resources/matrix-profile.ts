import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import type MatrixService from '../services/matrix-service';

export class MatrixProfileResource extends Resource<{}> {
  @tracked loading: Promise<void> | undefined;

  @tracked avatarUrl: string | undefined;
  @tracked displayName: string | undefined;

  @service private declare matrixService: MatrixService;

  modify(_positional: never[], _named: never) {
    this.loading = this.load.perform();
    // FIXME need to listen for profile change events
  }

  private load = restartableTask(async () => {
    if (this.matrixService.userId) {
      let rawProfile = await this.matrixService.client.getProfileInfo(
        this.matrixService.userId,
      );

      if (rawProfile) {
        this.avatarUrl = rawProfile.avatar_url;
        this.displayName = rawProfile.displayname;
      }
    }
  });
}

export function getMatrixProfile(parent: object) {
  console.log('get matrix profile');
  return MatrixProfileResource.from(parent, () => {});
}
