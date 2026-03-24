export class FactoryEntrypointUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactoryEntrypointUsageError';
  }
}
