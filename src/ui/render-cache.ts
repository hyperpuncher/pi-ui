export function deleteStringKeysWithPrefix<Value>(
	entries: Map<string, Value>,
	prefix: string,
): void {
	for (const key of entries.keys()) {
		if (key.startsWith(prefix)) entries.delete(key);
	}
}

export class BoundedCache<Key, Value> {
	readonly #entries = new Map<Key, Value>();

	constructor(readonly maxSize: number) {
		if (!Number.isInteger(maxSize) || maxSize <= 0) {
			throw new RangeError("BoundedCache maxSize must be a positive integer");
		}
	}

	get size(): number {
		return this.#entries.size;
	}

	get(key: Key): Value | undefined {
		return this.#entries.get(key);
	}

	set(key: Key, value: Value): void {
		this.#entries.delete(key);
		this.#entries.set(key, value);
		if (this.#entries.size > this.maxSize) {
			const oldest = this.#entries.keys().next();
			if (!oldest.done) this.#entries.delete(oldest.value);
		}
	}

	delete(key: Key): boolean {
		return this.#entries.delete(key);
	}

	clear(): void {
		this.#entries.clear();
	}
}
