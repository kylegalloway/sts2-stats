export type EntityType = 'card' | 'relic' | 'monster' | 'event';

// entityType param kept for type-safety at call sites; formula is identical for all types today.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function nameToId(name: string, entityType: EntityType): string {
  return name.toLowerCase().replace(/ /g, '_');
}
