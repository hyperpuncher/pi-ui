export function deleteStringKeysWithPrefix<Value>(
	entries: Map<string, Value>,
	prefix: string,
): void {
	for (const key of entries.keys()) {
		if (key.startsWith(prefix)) entries.delete(key);
	}
}

export type BoundedCacheOptions<Key, Value> = {
	maxWeight: number;
	weight: (key: Key, value: Value) => number;
};

export class BoundedCache<Key, Value> {
	readonly #entries = new Map<Key, { value: Value; weight: number }>();
	#weight = 0;

	constructor(
		readonly maxSize: number,
		private readonly options?: BoundedCacheOptions<Key, Value>,
	) {
		if (!Number.isInteger(maxSize) || maxSize <= 0) {
			throw new RangeError("BoundedCache maxSize must be a positive integer");
		}
		if (options && (!Number.isFinite(options.maxWeight) || options.maxWeight <= 0)) {
			throw new RangeError("BoundedCache maxWeight must be positive");
		}
	}

	get size(): number {
		return this.#entries.size;
	}

	get(key: Key): Value | undefined {
		return this.#entries.get(key)?.value;
	}

	set(key: Key, value: Value): void {
		this.delete(key);
		const weight = this.options?.weight(key, value) ?? 0;
		if (!Number.isFinite(weight) || weight < 0) {
			throw new RangeError("BoundedCache entry weight must be non-negative");
		}
		this.#entries.set(key, { value, weight });
		this.#weight += weight;
		while (
			this.#entries.size > this.maxSize ||
			(this.options && this.#weight > this.options.maxWeight)
		) {
			const oldest = this.#entries.keys().next();
			if (oldest.done) break;
			this.delete(oldest.value);
		}
	}

	delete(key: Key): boolean {
		const entry = this.#entries.get(key);
		if (!entry) return false;
		this.#entries.delete(key);
		this.#weight -= entry.weight;
		return true;
	}

	clear(): void {
		this.#entries.clear();
		this.#weight = 0;
	}
}
