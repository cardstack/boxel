import Route from '@ember/routing/route';

export default class MotionStudyDetails extends Route {
  model(params) {
    return Number(params.id);
  }
}
