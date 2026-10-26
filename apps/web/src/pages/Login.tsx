import { useState } from 'react';
import { api } from '../api';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      onLoggedIn();
    } catch {
      setError('That email and password did not match.');
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="logo big"><img src="/icon.svg" alt="" /> <span>Quantum Frame Connect</span></div>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}
