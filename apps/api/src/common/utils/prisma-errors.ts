import { Prisma } from '@prisma/client';

/** P2025: an update or delete matched no row, e.g. its owner predicate excluded it. */
export function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

/** P2002: a unique constraint rejected the write, e.g. a concurrent insert won. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Resolves to null when an owner-scoped write matched no row, so services can
 * answer with the same owner-safe 404 as a missing record (SEC-001, SEC-005).
 */
export async function nullIfNotFound<T>(write: Promise<T>): Promise<T | null> {
  try {
    return await write;
  } catch (error) {
    if (isRecordNotFound(error)) {
      return null;
    }
    throw error;
  }
}
