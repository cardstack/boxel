export class WorkerError extends Error {
  constructor(readonly response: Response) {
    super(`WorkerError ${response.status}`);
  }

  static withResponse(response: Response) {
    return new WorkerError(response);
  }
}
