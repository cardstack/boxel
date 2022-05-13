import Route from '@ember/routing/route';

interface Params {
  id: string;
}

export default class MotionStudyDetails extends Route {
  model(params: Params): number {
    return Number(params.id);
  }
}
