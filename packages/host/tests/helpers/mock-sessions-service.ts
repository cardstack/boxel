import Service from '@ember/service';

export function setupSessionsServiceMock(
  hooks: NestedHooks,
  read?: boolean,
  write?: boolean,
) {
  hooks.beforeEach(function () {
    this.owner.register(
      'service:sessions-service',
      generateMockSessionsService(read ?? true, write ?? true),
    );
  });
}

function generateMockSessionsService(read: boolean, write: boolean) {
  class MockSessionsService extends Service {
    get canRead() {
      return read;
    }

    get canWrite() {
      return write;
    }
  }

  return MockSessionsService;
}
