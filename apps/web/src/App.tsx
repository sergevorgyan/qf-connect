import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, ApiError } from './api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Calls } from './pages/Calls';
import { Voicemail } from './pages/Voicemail';
import { Messages } from './pages/Messages';
import { Team } from './pages/Team';
import { Integrations } from './pages/Integrations';
import { Admin } from './pages/Admin';

export interface Me {
  user: { id: number; name: string; email: string; role: 'qf_admin' | 'tenant_admin' | 'staff'; tenantId: number | null };
  tenant: { id: number; name: string; brandColor: string | null } | null;
}

const NAV = [
  ['/', 'Dashboard'], ['/calls', 'Calls'], ['/voicemail', 'Voicemail'], ['/messages', 'Messages'], ['/team', 'Team'], ['/integrations', 'Integrations'],
] as const;

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const refresh = () => api<Me>('/api/me').then(setMe, (e) => (e instanceof ApiError && e.status === 401 ? setMe(null) : setMe(null)));
  useEffect(() => { refresh(); }, []);

  if (me === undefined) return <div className="center muted">Loading...</div>;
  if (me === null) return <Login onLoggedIn={refresh} />;

  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); setMe(null); };
  const isQf = me.user.role === 'qf_admin';
  const style = me.tenant?.brandColor ? ({ '--brand': me.tenant.brandColor } as React.CSSProperties) : undefined;

  return (
    <div className="shell" style={style}>
      <aside className="sidebar">
        <div className="logo"><img src="/icon.svg" alt="" /> <span>Quantum Frame</span></div>
        {me.tenant && <div className="tenant">{me.tenant.name}</div>}
        <nav>
          {me.tenant && NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
          {isQf && <NavLink to="/admin">Customers</NavLink>}
        </nav>
        <div className="me">
          <div>{me.user.name}</div>
          <button className="link" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main>
        <Routes>
          {me.tenant ? (
            <>
              <Route path="/" element={<Dashboard />} />
              <Route path="/calls" element={<Calls />} />
              <Route path="/voicemail" element={<Voicemail />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/team" element={<Team />} />
              <Route path="/integrations" element={<Integrations canEdit={me.user.role !== 'staff'} />} />
            </>
          ) : (
            <Route path="/" element={<Navigate to="/admin" />} />
          )}
          {isQf && <Route path="/admin" element={<Admin actingTenantId={me.user.tenantId} onSwitch={refresh} />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
