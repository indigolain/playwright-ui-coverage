import { test, expect } from './fixtures';
import { Counter } from '../src/Counter';

test('increments', async ({ mount }) => {
  const component = await mount(<Counter />);
  await component.getByTestId('increment').click();
  await component.getByTestId('increment').click();
  await expect(component).toContainText('Count: 2');
});

test('respects the step', async ({ mount }) => {
  const component = await mount(<Counter initial={10} step={5} />);
  await component.getByTestId('increment').click();
  await expect(component).toContainText('Count: 15');
});

// Nothing clicks "−" or "Reset", so they show up as untested.
