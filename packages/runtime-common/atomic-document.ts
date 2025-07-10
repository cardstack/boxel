import { ErrorDetails } from './error';

export type AtomicOperationType = 'add' | 'update' | 'remove';

// Simplified operation for file writes
export interface AtomicOperation {
  op: AtomicOperationType;
  href: string; // Simple path-based targeting
  data?: any; // File content or card data
}

type AtomicPayloadErrorStatusCodes = 400 | 401 | 403 | 404 | 405 | 409 | 422;

export interface AtomicPayloadValidationError extends ErrorDetails {
  title: string;
  detail: string;
  status: AtomicPayloadErrorStatusCodes;
}

// Simple document structure
export interface AtomicDocumentBase {
  meta?: Record<string, any>;
}

export interface AtomicOperationsRequest extends AtomicDocumentBase {
  'atomic:operations': AtomicOperation[];
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

export interface AtomicOperationsSuccessResponse extends AtomicDocumentBase {
  'atomic:results': AtomicOperationResult[];
}

export interface AtomicOperationsErrorResponse extends AtomicDocumentBase {
  errors: ErrorDetails[];
}

export type AtomicOperationsResponse =
  | AtomicOperationsSuccessResponse
  | AtomicOperationsErrorResponse;

// Simplified validation - just check the basics
export function isAtomicOperation(
  operation: any,
): operation is AtomicOperation {
  return (
    typeof operation === 'object' &&
    operation != null &&
    typeof operation.op === 'string' &&
    ['add', 'update', 'remove'].includes(operation.op) &&
    typeof operation.href === 'string'
  );
}

export function isAtomicOperationsRequest(
  req: any,
): req is AtomicOperationsRequest {
  return (
    typeof req === 'object' &&
    req != null &&
    Array.isArray(req['atomic:operations']) &&
    req['atomic:operations'].every(isAtomicOperation)
  );
}

// Helper functions
export function createAtomicSuccessResponse(
  results: AtomicOperationResult[],
  meta?: Record<string, any>,
): AtomicOperationsSuccessResponse {
  return {
    'atomic:results': results,
    ...(meta && { meta }),
  };
}
