import { ErrorDetails } from './error';
import {
  ModuleResource,
  CardResource,
  isCardResource,
  isModuleResource,
} from './resource-types';

export type AtomicOperationType = 'add' | 'update' | 'remove';

export interface AtomicOperation {
  op: AtomicOperationType;
  href: string;
  data?: ModuleResource | CardResource;
}

type AtomicPayloadErrorStatusCodes = 400 | 401 | 403 | 404 | 405 | 409 | 422;

export interface AtomicPayloadValidationError extends ErrorDetails {
  title: string;
  detail: string;
  status: AtomicPayloadErrorStatusCodes;
}
export interface AtomicOperationResult {
  data: {
    id: string; //full path
  };
  meta?: {
    href?: string; //local path
    created?: number;
  };
}

export function filterOperationsWithCardData(
  operations: AtomicOperation[],
): (AtomicOperation & { data: CardResource })[] {
  return operations.filter(
    (op): op is AtomicOperation & { data: CardResource } =>
      op.data != null && isCardResource(op.data),
  );
}

export function filterOperationsWithSourceData(
  operations: AtomicOperation[],
): (AtomicOperation & { data: ModuleResource })[] {
  return operations.filter(
    (op): op is AtomicOperation & { data: ModuleResource } =>
      op.data != null && isModuleResource(op.data),
  );
}
