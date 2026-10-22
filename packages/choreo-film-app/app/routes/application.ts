import Route from '@ember/routing/route';
import type { ComponentLike } from '@glint/template';
import { filmName } from 'choreo-film-app/lib/film-name';
import { pictureDocument } from 'choreo-film-app/lib/picture-document';

export interface FilmModel {
  Film?: ComponentLike<{ Args: { embed?: boolean; picture?: string } }>;
  /** the picture's page for a film that has one, loaded before the film mounts */
  picture?: string;
}

/**
 * Loads the one film this document plays. Each film is its own chunk, so a
 * document downloads only its own film: Sylva's three.js stays out of Towers.
 */
export default class ApplicationRoute extends Route {
  async model(): Promise<FilmModel> {
    switch (filmName()) {
      case 'towers': {
        const [{ default: Film }, picture] = await Promise.all([
          import('choreo-film-app/components/tower-film'),
          pictureDocument('towers'),
        ]);
        return { Film, picture };
      }
      case 'sagrada': {
        const [{ default: Film }, picture] = await Promise.all([
          import('choreo-film-app/components/sagrada-film'),
          pictureDocument('sagrada'),
        ]);
        return { Film, picture };
      }
      case 'sylva': {
        const { SylvaStage } =
          await import('choreo-film-app/components/sylva-stage');
        return { Film: SylvaStage };
      }
      default:
        return {};
    }
  }
}
