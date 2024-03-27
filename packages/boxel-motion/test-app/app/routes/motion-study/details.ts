import Route from '@ember/routing/route';

export default class MotionStudyDetails extends Route {
  model(params: Record<string, string>): string {
    return params.id;
  }
}
