export class CircularFifoQueue<T> {
  readonly capacity: number;
  private buffer: (T | null)[];
  private head: number;
  private tail: number;
  private count: number;

  constructor(capacity: number) {
    if (capacity < 0) {
      throw new Error(`Capacity must be non-negative, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  add(item: T): void {
    if (this.capacity === 0) {
      return;
    }

    const clonedItem = structuredClone(item);

    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count++;
    }

    this.buffer[this.tail] = clonedItem;
    this.tail = (this.tail + 1) % this.capacity;
  }

  toArray(): T[] {
    const result: T[] = [];
    if (this.count === 0) {
      return result;
    }

    let index = this.head;
    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[index];
      if (item !== null) {
        result.push(structuredClone(item));
      }
      index = (index + 1) % this.capacity;
    }

    return result;
  }

  getFirst(): T | null {
    if (this.count === 0) {
      return null;
    }
    const item = this.buffer[this.head];
    return item !== null ? structuredClone(item) : null;
  }

  getLast(): T | null {
    if (this.count === 0) {
      return null;
    }
    const lastIndex = (this.tail - 1 + this.capacity) % this.capacity;
    const item = this.buffer[lastIndex];
    return item !== null ? structuredClone(item) : null;
  }

  getCapacity(): number {
    return this.capacity;
  }

  getLength(): number {
    return this.count;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.buffer[i] = null;
    }
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  clone(): CircularFifoQueue<T> {
    const cloned = new CircularFifoQueue<T>(this.capacity);
    cloned.head = this.head;
    cloned.tail = this.tail;
    cloned.count = this.count;
    for (let i = 0; i < this.capacity; i++) {
      if (this.buffer[i] !== null) {
        cloned.buffer[i] = structuredClone(this.buffer[i]);
      }
    }
    return cloned;
  }
}