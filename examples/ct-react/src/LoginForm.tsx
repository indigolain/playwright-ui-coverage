import { useState } from 'react';

export function LoginForm({ onSubmit }: { onSubmit?: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <p className="card">Welcome, {email}!</p>;

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(true);
        onSubmit?.(email);
      }}
    >
      <label>
        Email
        <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          name="password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="row" style={{ flexDirection: 'row' }}>
        <input name="show-password" type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
        Show password
      </label>
      <label>
        Language
        <select name="language" defaultValue="en">
          <option value="en">English</option>
          <option value="ja">日本語</option>
        </select>
      </label>
      <div className="row">
        <button type="submit" data-testid="sign-in">
          Sign in
        </button>
        <a href="#forgot" data-testid="forgot">
          Forgot password?
        </a>
      </div>
    </form>
  );
}
