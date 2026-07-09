import { useState } from 'react';

import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';

const TOKEN_STORAGE_KEY = 'dpe_access_token';

export default function App() {
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY));

  function handleLogin(token: string) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setAccessToken(token);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAccessToken(null);
  }

  if (!accessToken) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <DashboardPage accessToken={accessToken} onLogout={handleLogout} />;
}
