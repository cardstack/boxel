// This is a very special type of error that is used as a signal for us that
// there is unfinished async work when loading card field values.
export class NotReady extends Error {
  isNotReadyError: true = true;
  constructor(
    readonly instance: any,
    readonly fieldName: string,
    readonly computeVia: string | Function,
  ) {
    super(`The field ${instance.constructor.name}.${fieldName} is not ready`);
  }
}

export function isNotReadyError(err: any): err is NotReady {
  return (
    err != null &&
    typeof err === 'object' &&
    err.isNotReadyError &&
    'fieldName' in err &&
    'computeVia' in err &&
    'instance' in err
  );
}
