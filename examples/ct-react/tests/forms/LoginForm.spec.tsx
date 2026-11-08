import { test, expect } from '../fixtures';
import { LoginForm } from '../../src/LoginForm';

test('signs in', async ({ mount }) => {
  let submitted = '';
  const component = await mount(<LoginForm onSubmit={(email) => (submitted = email)} />);
  await component.getByLabel('Email').fill('ada@example.com');
  await component.getByLabel('Password', { exact: true }).fill('hunter2');
  await component.getByTestId('sign-in').click();
  await expect(component).toContainText('Welcome, ada@example.com!');
  expect(submitted).toBe('ada@example.com');
});

test('shows the password', async ({ mount }) => {
  const component = await mount(<LoginForm />);
  await component.getByLabel('Show password').check();
  await expect(component.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
});

// The language select and the "Forgot password?" link are left untested.
