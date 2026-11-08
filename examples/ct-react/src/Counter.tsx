import { useState } from 'react';

export function Counter({ initial = 0, step = 1 }: { initial?: number; step?: number }) {
  const [count, setCount] = useState(initial);
  return (
    <div className="card">
      <strong>Count: {count}</strong>
      <div className="row">
        <button data-testid="decrement" onClick={() => setCount((c) => c - step)}>
          −
        </button>
        <button data-testid="increment" onClick={() => setCount((c) => c + step)}>
          +
        </button>
        <button data-testid="reset" onClick={() => setCount(initial)}>
          Reset
        </button>
      </div>
    </div>
  );
}
