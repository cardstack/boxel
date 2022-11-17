export class NotLoaded extends Error {
  readonly isNotLoadedError: true = true;
  constructor(
    readonly reference: string,
    readonly fieldName: string,
    readonly cardName: string
  ) {
    super(
      `The field ${cardName}.${fieldName} refers to the card instance ${reference} which is not loaded`
    );
  }
}

export function isNotLoadedError(err: any): err is NotLoaded {
  return (
    err != null &&
    typeof err === "object" &&
    err.isNotLoadedError === true &&
    "fieldName" in err &&
    "reference" in err
  );
}
