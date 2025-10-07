import { ErrorDetails } from './error';
import {
  ModuleResource,
  isCardResource,
  isModuleResource,
} from './resource-types';
import { LooseCardResource } from './index';

export type AtomicOperationType = 'add' | 'update' | 'remove';

export interface AtomicOperationDocument {
  'atomic:operations': AtomicOperation[];
}

export interface AtomicOperation {
  op: AtomicOperationType;
  href: string;
  data?: ModuleResource | LooseCardResource;
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
    created?: number | null;
  };
}

export function filterAtomicOperations(
  operations: AtomicOperation[],
): (AtomicOperation & { data: LooseCardResource | ModuleResource })[] {
  return operations.filter(
    (op): op is AtomicOperation & { data: LooseCardResource } =>
      (op.data != null && isCardResource(op.data)) || isModuleResource(op.data),
  );
}

//This helper ensures that the atomic document is re-ordered correctly
export function createAtomicDocument(
  operations: AtomicOperation[],
): AtomicOperationDocument {
  return {
    'atomic:operations': operations,
  };
}
