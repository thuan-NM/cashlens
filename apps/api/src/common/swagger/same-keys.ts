/**
 * Compile-time check that two object types have exactly the same keys.
 *
 * Some responses embed a Prisma entity that is serialized as-is (Dates become
 * ISO strings, Decimals become strings). Their OpenAPI description is a DTO
 * class that cannot be the entity's TypeScript type, so this check pins the
 * documented field list to the entity: adding or removing a column fails
 * compilation until the documentation follows.
 *
 * Usage: `export type Check = ExpectTrue<SameKeys<Entity, DocumentationDto>>;`
 */
export type SameKeys<A, B> = [
  Exclude<keyof A, keyof B>,
  Exclude<keyof B, keyof A>,
] extends [never, never]
  ? true
  : false;

/** Fails compilation unless `T` is `true`. */
export type ExpectTrue<T extends true> = T;
