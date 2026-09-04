// Page-local cache: never shared between identities or publishing scopes.
export function createPublishCache<T>(ttl = 60_000, capacity = 30) {
  const entries = new Map<string, { value?: T; expires: number; pending?: Promise<T> }>();
  function read(key: string) {
    const entry = entries.get(key);
    return entry && entry.expires > Date.now() ? entry.value : undefined;
  }
  function write(key: string, value: T) {
    entries.delete(key);
    entries.set(key, { value, expires: Date.now() + ttl });
    if (entries.size > capacity) entries.delete(entries.keys().next().value!);
  }
  async function get(key: string, load: () => Promise<T>): Promise<T> {
    const value = read(key);
    if (value !== undefined) return value;
    const existing = entries.get(key);
    if (existing?.pending) return existing.pending;
    const entry: { value?: T; expires: number; pending?: Promise<T> } = { expires: 0 };
    entries.set(key, entry);
    if (entries.size > capacity) entries.delete(entries.keys().next().value!);
    entry.pending = Promise.resolve().then(load).then(value => {
      if (entries.get(key) === entry) write(key, value);
      return value;
    }, error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    return entry.pending;
  }
  return { read, write, get, clear: () => entries.clear() };
}
