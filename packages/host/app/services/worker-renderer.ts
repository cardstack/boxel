import Service from '@ember/service';

export default class WorkerRenderer extends Service {
  async visit(
    _path: string,
    _staticResponses: Map<string, string>,
    send: (html: string) => void
  ) {
    Promise.resolve();
    let html = `
    <!--Server Side Rendered Card START-->
    <h1>Hello World!</h1>
    <!--Server Side Rendered Card END-->
    `;
    send(html);
  }
}
