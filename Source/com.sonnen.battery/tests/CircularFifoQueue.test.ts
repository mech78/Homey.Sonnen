import { CircularFifoQueue } from '../domain/CircularFifoQueue';

interface ComplexItem {
  value: number;
  name: string;
}

describe('CircularFifoQueue<number> - Basic Operations', () => {
  it('should create empty queue with valid capacity', () => {
    const queue = new CircularFifoQueue<number>(5);
    expect(queue.getCapacity()).toBe(5);
    expect(queue.getLength()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
  });

  it('should create empty queue with zero capacity', () => {
    const queue = new CircularFifoQueue<number>(0);
    expect(queue.getCapacity()).toBe(0);
    expect(queue.getLength()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
  });

  it('should throw error for negative capacity', () => {
    expect(() => new CircularFifoQueue<number>(-1)).toThrow('Capacity must be non-negative');
  });

  it('should add items correctly', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(1);
    queue.add(2);
    queue.add(3);

    expect(queue.getLength()).toBe(3);
    expect(queue.toArray()).toEqual([1, 2, 3]);
  });

  it('should return first item', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(10);
    queue.add(20);
    queue.add(30);

    expect(queue.getFirst()).toBe(10);
  });

  it('should return last item', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(10);
    queue.add(20);
    queue.add(30);

    expect(queue.getLast()).toBe(30);
  });

  it('should return undefined for first/last when empty', () => {
    const queue = new CircularFifoQueue<number>(5);
    expect(queue.getFirst()).toBeUndefined();
    expect(queue.getLast()).toBeUndefined();
  });

  it('should return items in insertion order via toArray', () => {
    const queue = new CircularFifoQueue<number>(5);
    queue.add(1);
    queue.add(2);
    queue.add(3);

    expect(queue.toArray()).toEqual([1, 2, 3]);
  });

  it('should return empty array when calling toArray on empty queue', () => {
    const queue = new CircularFifoQueue<number>(5);
    expect(queue.toArray()).toEqual([]);
  });
});

describe('CircularFifoQueue<number> - Overflow Behavior', () => {
  it('should evict oldest item when queue is full', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(1);
    queue.add(2);
    queue.add(3);
    queue.add(4);

    expect(queue.getLength()).toBe(3);
    expect(queue.toArray()).toEqual([2, 3, 4]);
    expect(queue.getFirst()).toBe(2);
    expect(queue.getLast()).toBe(4);
  });

  it('should handle multiple overflows correctly', () => {
    const queue = new CircularFifoQueue<number>(3);
    for (let i = 1; i <= 10; i++) {
      queue.add(i);
    }

    expect(queue.getLength()).toBe(3);
    expect(queue.toArray()).toEqual([8, 9, 10]);
    expect(queue.getFirst()).toBe(8);
    expect(queue.getLast()).toBe(10);
  });

  it('should maintain correct order after wrap-around', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(1);
    queue.add(2);
    queue.add(3);
    queue.add(4);
    queue.add(5);

    expect(queue.toArray()).toEqual([3, 4, 5]);
  });
});

describe('CircularFifoQueue<number> - Clear and Empty', () => {
  it('should clear all items', () => {
    const queue = new CircularFifoQueue<number>(5);
    queue.add(1);
    queue.add(2);
    queue.add(3);
    queue.clear();

    expect(queue.getLength()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.toArray()).toEqual([]);
  });

  it('should identify empty queue correctly', () => {
    const queue = new CircularFifoQueue<number>(5);
    expect(queue.isEmpty()).toBe(true);

    queue.add(1);
    expect(queue.isEmpty()).toBe(false);

    queue.clear();
    expect(queue.isEmpty()).toBe(true);
  });
});

describe('CircularFifoQueue<number> - Deep Cloning', () => {
  it('should return deep cloned items from toArray', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(100);
    queue.add(200);

    const items = queue.toArray();
    items[0] = 999;

    expect(queue.getFirst()).toBe(100);
  });

  it('should return deep cloned item from getFirst', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(42);

    const first = queue.getFirst();
    if (first !== undefined) {
      const modified = first + 1;
      expect(modified).toBe(43);
    }
    expect(queue.getFirst()).toBe(42);
  });

  it('should return deep cloned item from getLast', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(42);

    const last = queue.getLast();
    if (last !== undefined) {
      const modified = last + 1;
      expect(modified).toBe(43);
    }
    expect(queue.getLast()).toBe(42);
  });

  it('should create independent clone of queue', () => {
    const original = new CircularFifoQueue<number>(3);
    original.add(1);
    original.add(2);
    original.add(3);

    const cloned = original.clone();
    cloned.add(4);

    expect(original.toArray()).toEqual([1, 2, 3]);
    expect(cloned.toArray()).toEqual([2, 3, 4]);
  });

  it('should clone with deep copied items', () => {
    const original = new CircularFifoQueue<number>(3);
    original.add(100);

    const cloned = original.clone();
    const items = cloned.toArray();
    items[0] = 999;

    expect(cloned.getFirst()).toBe(100);
    expect(original.getFirst()).toBe(100);
  });
});

describe('CircularFifoQueue<number> - JSON Serialization', () => {
  it('should serialize to JSON with internal state', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(1);
    queue.add(2);

    const json = JSON.stringify(queue);
    const parsed = JSON.parse(json);

    expect(parsed.capacity).toBe(3);
    expect(parsed.buffer).toHaveLength(2);
    expect(parsed.buffer[0]).toBe(1);
    expect(parsed.buffer[1]).toBe(2);
    expect(parsed.head).toBe(0);
    expect(parsed.tail).toBe(2);
    expect(parsed.count).toBe(2);
  });
});

describe('CircularFifoQueue<ComplexItem> - Complex Objects', () => {
  it('should add complex objects', () => {
    const queue = new CircularFifoQueue<ComplexItem>(3);
    queue.add({ value: 1, name: 'Alice' });
    queue.add({ value: 2, name: 'Bob' });

    expect(queue.getLength()).toBe(2);
  });

  it('should return items in insertion order', () => {
    const queue = new CircularFifoQueue<ComplexItem>(3);
    queue.add({ value: 1, name: 'Alice' });
    queue.add({ value: 2, name: 'Bob' });
    queue.add({ value: 3, name: 'Charlie' });

    const items = queue.toArray();
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ value: 1, name: 'Alice' });
    expect(items[1]).toEqual({ value: 2, name: 'Bob' });
    expect(items[0]!.value).toBe(1);
    expect(items[0]!.name).toBe('Alice');
  });

  it('should deep clone complex objects on return', () => {
    const queue = new CircularFifoQueue<ComplexItem>(3);
    queue.add({ value: 100, name: 'Test' });

    const items = queue.toArray();
    items[0]!.value = 999;
    items[0]!.name = 'Modified';

    const first = queue.getFirst();
    expect(first).not.toBeNull();
    if (first) {
      expect(first.value).toBe(100);
      expect(first.name).toBe('Test');
    }
  });

  it('should handle overflow with complex objects', () => {
    const queue = new CircularFifoQueue<ComplexItem>(2);
    queue.add({ value: 1, name: 'Alice' });
    queue.add({ value: 2, name: 'Bob' });
    queue.add({ value: 3, name: 'Charlie' });

    expect(queue.getLength()).toBe(2);
    const items = queue.toArray();
    expect(items[0]).toEqual({ value: 2, name: 'Bob' });
    expect(items[1]).toEqual({ value: 3, name: 'Charlie' });
  });

  it('should getFirst with complex object', () => {
    const queue = new CircularFifoQueue<ComplexItem>(3);
    queue.add({ value: 10, name: 'First' });
    queue.add({ value: 20, name: 'Second' });

    const first = queue.getFirst();
    expect(first).not.toBeNull();
    if (first) {
      expect(first.value).toBe(10);
      expect(first.name).toBe('First');
    }
  });

  it('should getLast with complex object', () => {
    const queue = new CircularFifoQueue<ComplexItem>(3);
    queue.add({ value: 10, name: 'First' });
    queue.add({ value: 20, name: 'Second' });

    const last = queue.getLast();
    expect(last).not.toBeNull();
    if (last) {
      expect(last.value).toBe(20);
      expect(last.name).toBe('Second');
    }
  });

  it('should clone queue with complex objects', () => {
    const original = new CircularFifoQueue<ComplexItem>(3);
    original.add({ value: 1, name: 'Alice' });
    original.add({ value: 2, name: 'Bob' });

    const cloned = original.clone();
    cloned.add({ value: 3, name: 'Charlie' });

    expect(original.toArray()).toHaveLength(2);
    expect(cloned.toArray()).toHaveLength(3);
    expect(cloned.toArray()[0]).toEqual({ value: 1, name: 'Alice' });
  });

  it('should deep clone complex objects when cloning', () => {
    const original = new CircularFifoQueue<ComplexItem>(3);
    original.add({ value: 100, name: 'Original' });

    const cloned = original.clone();
    const items = cloned.toArray();
    items[0]!.value = 999;
    items[0]!.name = 'Changed';

    expect(original.toArray()[0]).toEqual({ value: 100, name: 'Original' });
  });
});

describe('CircularFifoQueue<ComplexItem | null> - Nullable Types', () => {
  it('should allow null values when constructed with union type', () => {
    const queue = new CircularFifoQueue<ComplexItem | null>(5);
    queue.add({ value: 1, name: 'Alice' });
    queue.add(null);
    queue.add({ value: 2, name: 'Bob' });
    queue.add(null);
    queue.add({ value: 3, name: 'Charlie' });

    expect(queue.getLength()).toBe(5);
    const items = queue.toArray();
    expect(items).toEqual([
      { value: 1, name: 'Alice' },
      null,
      { value: 2, name: 'Bob' },
      null,
      { value: 3, name: 'Charlie' }
    ]);
  });

  it('should return null when first item is null', () => {
    const queue = new CircularFifoQueue<ComplexItem | null>(3);
    queue.add(null);
    queue.add({ value: 1, name: 'Alice' });
    queue.add({ value: 2, name: 'Bob' });

    expect(queue.getFirst()).toBeNull();  // Actually null, not undefined (item IS null)
    expect(queue.getLast()).toEqual({ value: 2, name: 'Bob' });
  });

  it('should return undefined for empty queue, even with nullable type', () => {
    const queue = new CircularFifoQueue<ComplexItem | null>(3);

    expect(queue.getFirst()).toBeUndefined();  // Empty queue
    expect(queue.getLast()).toBeUndefined();   // Empty queue
  });

  it('should serialize and deserialize null values correctly', () => {
    const queue = new CircularFifoQueue<ComplexItem | null>(3);
    queue.add({ value: 1, name: 'Alice' });
    queue.add(null);
    queue.add({ value: 3, name: 'Charlie' });

    const json = JSON.stringify(queue);
    const parsed = JSON.parse(json);

    expect(parsed.capacity).toBe(3);
    expect(parsed.buffer).toEqual([
      { value: 1, name: 'Alice' },
      null,
      { value: 3, name: 'Charlie' }
    ]);
    expect(parsed.buffer[1]).toBeNull();  // null preserved in JSON
  });
});

describe('CircularFifoQueue - JSON Serialization Round-trip with Wrap-around', () => {
  it('should serialize and deserialize queue with wrap-around (numbers)', () => {
    const original = new CircularFifoQueue<number>(3);
    original.add(1);
    original.add(2);
    original.add(3);
    original.add(4);
    original.add(5);

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const restored = new CircularFifoQueue<number>(parsed.capacity);
    restored.restoreFromSerialized(parsed.buffer, parsed.head, parsed.tail, parsed.count);

    expect(restored.getCapacity()).toBe(original.getCapacity());
    expect(restored.getLength()).toBe(original.getLength());
    expect(restored.toArray()).toEqual(original.toArray());
    expect(restored.getFirst()).toBe(original.getFirst());
    expect(restored.getLast()).toBe(original.getLast());
  });

  it('should serialize and deserialize queue with multiple wrap-arounds (numbers)', () => {
    const original = new CircularFifoQueue<number>(3);
    for (let i = 1; i <= 10; i++) {
      original.add(i);
    }

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const restored = new CircularFifoQueue<number>(parsed.capacity);
    restored.restoreFromSerialized(parsed.buffer, parsed.head, parsed.tail, parsed.count);

    expect(restored.getCapacity()).toBe(original.getCapacity());
    expect(restored.getLength()).toBe(original.getLength());
    expect(restored.toArray()).toEqual(original.toArray());
    expect(restored.getFirst()).toBe(8);
    expect(restored.getLast()).toBe(10);
  });

  it('should serialize and deserialize queue with wrap-around (complex objects)', () => {
    interface TestItem {
      id: number;
      label: string;
      active: boolean;
    }

    const original = new CircularFifoQueue<TestItem>(2);
    original.add({ id: 1, label: 'First', active: true });
    original.add({ id: 2, label: 'Second', active: false });
    original.add({ id: 3, label: 'Third', active: true });

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const restored = new CircularFifoQueue<TestItem>(parsed.capacity);
    restored.restoreFromSerialized(parsed.buffer, parsed.head, parsed.tail, parsed.count);

    expect(restored.getCapacity()).toBe(original.getCapacity());
    expect(restored.getLength()).toBe(original.getLength());
    expect(restored.toArray()).toEqual(original.toArray());
    expect(restored.getFirst()).toEqual({ id: 2, label: 'Second', active: false });
    expect(restored.getLast()).toEqual({ id: 3, label: 'Third', active: true });
  });

  it('should serialize and deserialize empty queue', () => {
    const original = new CircularFifoQueue<number>(5);

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const restored = new CircularFifoQueue<number>(parsed.capacity);
    restored.restoreFromSerialized(parsed.buffer, parsed.head, parsed.tail, parsed.count);

    expect(restored.getCapacity()).toBe(original.getCapacity());
    expect(restored.getLength()).toBe(original.getLength());
    expect(restored.toArray()).toEqual(original.toArray());
    expect(restored.isEmpty()).toBe(true);
  });

  it('should serialize and deserialize queue at full capacity without wrap-around', () => {
    const original = new CircularFifoQueue<number>(3);
    original.add(1);
    original.add(2);
    original.add(3);

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const restored = new CircularFifoQueue<number>(parsed.capacity);
    restored.restoreFromSerialized(parsed.buffer, parsed.head, parsed.tail, parsed.count);

    expect(restored.getCapacity()).toBe(original.getCapacity());
    expect(restored.getLength()).toBe(original.getLength());
    expect(restored.toArray()).toEqual(original.toArray());
    expect(restored.toArray()).toEqual([1, 2, 3]);
  });

  it('should preserve internal state after wrap-around serialization', () => {
    const original = new CircularFifoQueue<number>(3);
    original.add(10);
    original.add(20);
    original.add(30);
    original.add(40);

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const restored = new CircularFifoQueue<number>(parsed.capacity);
    restored.restoreFromSerialized(parsed.buffer, parsed.head, parsed.tail, parsed.count);

    const originalJson = JSON.parse(JSON.stringify(original));
    expect(parsed.head).toBe(originalJson.head);
    expect(parsed.tail).toBe(originalJson.tail);
    expect(parsed.count).toBe(originalJson.count);
    expect(parsed.buffer).toEqual(originalJson.buffer);
  });
});

describe('CircularFifoQueue - Edge Cases', () => {
  it('should handle adding to zero-capacity queue', () => {
    const queue = new CircularFifoQueue<number>(0);
    queue.add(1);
    queue.add(2);

    expect(queue.getLength()).toBe(0);
    expect(queue.toArray()).toEqual([]);
  });

  it('should handle large capacity queue', () => {
    const queue = new CircularFifoQueue<number>(10000);
    queue.add(1);
    queue.add(2);

    expect(queue.getCapacity()).toBe(10000);
    expect(queue.getLength()).toBe(2);
  });

  it('should clear zero-capacity queue safely', () => {
    const queue = new CircularFifoQueue<number>(0);
    expect(() => queue.clear()).not.toThrow();
  });
});

describe('CircularFifoQueue - toLog() Compact Logging', () => {
  it('should return compact object representation for empty queue', () => {
    const queue = new CircularFifoQueue<number>(5);
    const logOutput = queue.toLog();

    expect(logOutput).toEqual({
      capacity: 5,
      size: 0,
      head: 0,
      tail: 0,
      first: undefined,
      last: undefined
    });
  });

  it('should return compact object representation for single element', () => {
    const queue = new CircularFifoQueue<number>(5);
    queue.add(42);
    const logOutput = queue.toLog();

    expect(logOutput).toEqual({
      capacity: 5,
      size: 1,
      head: 0,
      tail: 1,
      first: 42,
      last: 42
    });
  });

  it('should return compact object representation for multiple elements', () => {
    const queue = new CircularFifoQueue<number>(5);
    queue.add(10);
    queue.add(20);
    queue.add(30);
    const logOutput = queue.toLog();

    expect(logOutput).toEqual({
      capacity: 5,
      size: 3,
      head: 0,
      tail: 3,
      first: 10,
      last: 30
    });
  });

  it('should handle wrap-around in compact log', () => {
    const queue = new CircularFifoQueue<number>(3);
    queue.add(1);
    queue.add(2);
    queue.add(3);
    queue.add(4);
    queue.add(5);
    const logOutput = queue.toLog();

    expect(logOutput).toEqual({
      capacity: 3,
      size: 3,
      head: 2,
      tail: 2,
      first: 3,
      last: 5
    });
  });

  it('should serialize complex objects in compact log', () => {
    const queue = new CircularFifoQueue<ComplexItem>(3);
    queue.add({ value: 1, name: 'Alice' });
    queue.add({ value: 2, name: 'Bob' });
    const logOutput = queue.toLog();

    expect(logOutput).toEqual({
      capacity: 3,
      size: 2,
      head: 0,
      tail: 2,
      first: { value: 1, name: 'Alice' },
      last: { value: 2, name: 'Bob' }
    });
  });

  it('should maintain correct head/tail values after multiple operations in log', () => {
    const queue = new CircularFifoQueue<number>(4);
    queue.add(1);
    queue.add(2);
    queue.add(3);
    queue.add(4);
    queue.add(5);
    queue.add(6);
    const logOutput = queue.toLog();

    expect(logOutput).toEqual({
      capacity: 4,
      size: 4,
      head: 2,
      tail: 2,
      first: 3,
      last: 6
    });
  });

  it('should handle zero-capacity queue in log', () => {
    const queue = new CircularFifoQueue<number>(0);
    const logOutput = queue.toLog();

    expect(logOutput).toEqual({
      capacity: 0,
      size: 0,
      head: 0,
      tail: 0,
      first: undefined,
      last: undefined
    });
  });
});