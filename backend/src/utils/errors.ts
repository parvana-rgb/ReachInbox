export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, details?: unknown) => new AppError(400, m, 'bad_request', details);
export const unauthorized = (m = 'Authentication required') => new AppError(401, m, 'unauthorized');
export const forbidden = (m = 'Forbidden') => new AppError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new AppError(404, m, 'not_found');
export const unavailable = (m: string) => new AppError(503, m, 'service_unavailable');
