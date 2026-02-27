export class CircularFifoQueue<T> {
  readonly capacity: number;
  private buffer: T[] = [];
  private head: number;
  private tail: number;
  private count: number;

  constructor(capacity: number) {
    if (capacity < 0) {
      throw new Error(`Capacity must be non-negative, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buffer = [];
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

    if (this.tail >= this.buffer.length) {
      this.buffer.length = this.tail + 1;
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
      result.push(structuredClone(this.buffer[index]));
      index = (index + 1) % this.capacity;
    }

    return result;
  }

  getFirst(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return structuredClone(this.buffer[this.head]);
  }

  getLast(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const lastIndex = (this.tail - 1 + this.capacity) % this.capacity;
    return structuredClone(this.buffer[lastIndex]);
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
    this.buffer = [];
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  clone(): CircularFifoQueue<T> {
    const cloned = new CircularFifoQueue<T>(this.capacity);
    cloned.head = this.head;
    cloned.tail = this.tail;
    cloned.count = this.count;
    for (let i = 0; i < this.buffer.length; i++) {
      cloned.buffer[i] = structuredClone(this.buffer[i]);
    }
    return cloned;
  }

  restoreFromSerialized(buffer: T[], head: number, tail: number, count: number): void {
    this.buffer = [...buffer];
    this.head = head;
    this.tail = tail;
    this.count = count;
  }

  toLog(): any {
  return {
    capacity: this.capacity,
    size: this.count,
    head: this.head,
    tail: this.tail,
    first: this.getFirst(),
    last: this.getLast()
  };
}
}