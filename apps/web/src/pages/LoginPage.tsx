import { FormEvent, useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, Mail } from 'lucide-react';

import { login } from '../api/client';

type LoginPageProps = {
  onLogin: (accessToken: string) => void;
};

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await login(email, password);
      onLogin(result.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to log in');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[minmax(360px,0.95fr)_1.05fr]">
        <section className="hidden bg-slate-950 px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500 text-sm font-black shadow-sm shadow-indigo-950/40">
              PP
            </div>
            <div>
              <p className="text-sm font-bold">PricePilot AI</p>
              <p className="text-xs text-slate-400">Dynamic Pricing Engine</p>
            </div>
          </div>

          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-300">
              Enterprise pricing operations
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight">
              Govern products, margins, and competitor scrapes from one focused workspace.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-300">
              PricePilot AI gives pricing teams a compact operational console for real product data and queue-backed scraping workflows.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="font-semibold text-white">JWT secured</p>
              <p className="mt-1 text-xs text-slate-400">Protected API access</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="font-semibold text-white">Queue aware</p>
              <p className="mt-1 text-xs text-slate-400">Redis health surfaced</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="font-semibold text-white">Operational</p>
              <p className="mt-1 text-xs text-slate-400">No fake metrics</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-10 sm:px-6 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white">
                  PP
                </div>
                <div>
                  <p className="font-bold text-slate-950">PricePilot AI</p>
                  <p className="text-sm text-slate-500">Dynamic Pricing Engine</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div>
                <p className="text-sm font-semibold text-indigo-700">Welcome back</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Sign in to PricePilot AI</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Use your API account to access product pricing and scraper queue controls.
                </p>
              </div>

              <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="email">
                    Email
                  </label>
                  <div className="relative mt-2">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="password">
                    Password
                  </label>
                  <div className="relative mt-2">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-11 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      className="absolute right-2 top-1/2 rounded-lg p-2 text-slate-500 transition -translate-y-1/2 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                    {error}
                  </div>
                ) : null}

                <button
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isSubmitting ? 'Signing in' : 'Sign in'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
