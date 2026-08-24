/** Standard API error shape: { error: { code, message } } (rest-api.md). */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  unauthorized: (msg = 'Authentication required') => new ApiError(401, 'unauthorized', msg),
  vaultLocked: (msg = 'Vault is locked') => new ApiError(423, 'vault_locked', msg),
  lockedOut: (msg = 'Account temporarily locked') => new ApiError(423, 'locked_out', msg),
  notFound: (msg = 'Not found') => new ApiError(404, 'not_found', msg),
  conflict: (code: string, msg: string) => new ApiError(409, code, msg),
  validation: (msg: string) => new ApiError(400, 'validation_error', msg),
  precondition: (msg: string) => new ApiError(422, 'precondition_failed', msg),
  forbidden: (msg = 'Forbidden') => new ApiError(403, 'forbidden', msg),
  internal: (msg = 'Internal error') => new ApiError(500, 'internal_error', msg),
};
