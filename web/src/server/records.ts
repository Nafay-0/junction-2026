/**
 * Small keyed records that must outlive a restart: operator suspensions, a kitchen's reissued mandate. Held in
 * memory by default and in PostgreSQL when DOCK_STORE=postgres (src/server/aiven/index.ts, the `docs` table), like
 * every other store the runtime plugs in.
 */
export interface RecordStore<T> {
  put(id: string, value: T): Promise<void>;
  list(): Promise<T[]>;
}

export class InMemoryRecordStore<T> implements RecordStore<T> {
  private readonly items = new Map<string, T>();
  async put(id: string, value: T) {
    this.items.set(id, structuredClone(value));
  }
  async list() {
    return structuredClone([...this.items.values()]);
  }
}

/** One store per collection name, made on first use. */
export type Records = <T>(collection: string) => RecordStore<T>;

export function inMemoryRecords(): Records {
  const stores = new Map<string, InMemoryRecordStore<unknown>>();
  return <T>(collection: string) => {
    let s = stores.get(collection);
    if (!s) stores.set(collection, (s = new InMemoryRecordStore<unknown>()));
    return s as unknown as RecordStore<T>;
  };
}
