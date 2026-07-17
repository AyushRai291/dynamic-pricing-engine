import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  ApiError,
  AuthResponse,
  AuthUser,
  clearAuthSession,
  getAuthSession,
  getCurrentUser,
  logout,
  saveAuthSession,
  subscribeAuthSession,
} from './api/client';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';

export default function App() {
  const authSession = useSyncExternalStore(subscribeAuthSession, getAuthSession);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userLoadError, setUserLoadError] = useState('');
  const [userLoadKey, setUserLoadKey] = useState(0);

  useEffect(() => {
    if (!authSession.accessToken) {
      setUser(null);
      setUserLoadError('');
      return undefined;
    }

    let ignore = false;
    setUserLoadError('');

    void getCurrentUser(authSession.accessToken)
      .then((response) => {
        if (!ignore) {
          setUser(response.user);
        }
      })
      .catch((error) => {
        if (ignore) {
          return;
        }

        if (error instanceof ApiError && error.statusCode === 401) {
          clearAuthSession();
          return;
        }

        setUserLoadError(error instanceof Error ? error.message : 'Unable to load your account.');
      });

    return () => {
      ignore = true;
    };
  }, [authSession.accessToken, userLoadKey]);

  function handleAuthenticated(response: AuthResponse) {
    setUser(null);
    saveAuthSession(response.accessToken);
  }

  function handleLogout() {
    void logout().catch(() => {});
    clearAuthSession();
    setUser(null);
  }

  if (!authSession.accessToken) {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-indigo-700">PricePilot AI</p>
          <h1 className="mt-2 text-xl font-bold">
            {userLoadError ? 'Unable to load your account' : 'Loading your workspace'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {userLoadError || 'Confirming your current user and permissions.'}
          </p>
          {userLoadError ? (
            <div className="mt-5 flex justify-center gap-3">
              <button
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white"
                type="button"
                onClick={() => setUserLoadKey((value) => value + 1)}
              >
                Retry
              </button>
              <button
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                type="button"
                onClick={handleLogout}
              >
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <DashboardPage
      accessToken={authSession.accessToken}
      user={user}
      onLogout={handleLogout}
    />
  );
}
