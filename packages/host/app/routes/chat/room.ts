import Route from '@ember/routing/route';

export default class Room extends Route<{ roomId: string }> {
  async model(params: { id: string }) {
    let { id } = params;
    return { roomId: id };
  }
}
