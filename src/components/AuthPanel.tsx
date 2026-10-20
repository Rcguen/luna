import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured, supabaseSetupMessage } from '../lib/supabase';
import { authRedirectUrl, cleanAuthCallbackUrl, formatAuthError, readAuthCallbackError } from '../lib/authRedirect';

export function AuthPanel({ onSession }: { onSession: (session: Session | null) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [expired, setExpired] = useState(false); const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const callbackError = formatAuthError(readAuthCallbackError());
    if (callbackError.message) { setMessage(callbackError.message); setExpired(callbackError.expired); }
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(formatAuthError(error).message);
      setSession(data.session); onSession(data.session);
      if (data.session?.user.email_confirmed_at && !callbackError.message) setMessage('Email confirmed. You can use Luna cloud saves.');
      cleanAuthCallbackUrl();
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next); onSession(next);
      if (event === 'PASSWORD_RECOVERY') { setRecovery(true); setMessage('Recovery link accepted. Choose a new password.'); }
      if (event === 'SIGNED_IN' && next?.user.email_confirmed_at) { setExpired(false); setMessage('Email confirmed. You can use Luna cloud saves.'); }
    });
    return () => data.subscription.unsubscribe();
  }, [onSession]);
  if (!supabaseConfigured) return <div className="account-card"><strong>Cloud library</strong><p className="muted">{supabaseSetupMessage}</p><p className="muted">Create a Supabase project, apply the migration, then add the values to `.env.local` for local development and GitHub Actions secrets for deployment.</p></div>;
  const submit = async () => { setBusy(true); setMessage(''); setExpired(false); const result = mode === 'sign-in' ? await supabase?.auth.signInWithPassword({ email, password }) : await supabase?.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl() } }); setBusy(false); if (result?.error) { const formatted = formatAuthError(result.error); setMessage(formatted.message); setExpired(formatted.expired || /not confirmed/i.test(result.error.message)); } else setMessage(mode === 'sign-up' ? 'Check your email to confirm the account.' : 'Signed in.'); };
  const resend = async () => { if (!email) { setMessage('Enter your email first.'); return; } setBusy(true); setMessage('Sending a new confirmation email…'); const result = await supabase?.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authRedirectUrl() } }); setBusy(false); if (result?.error) setMessage(formatAuthError(result.error).message); else { setExpired(false); setMessage('A new confirmation email was requested. Check your inbox and spam folder.'); } };
  const reset = async () => { if (!email) { setMessage('Enter your email first.'); return; } setBusy(true); const result = await supabase?.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() }); setBusy(false); setMessage(result?.error ? formatAuthError(result.error).message : 'Password reset email requested.'); };
  const updatePassword = async () => { if (password.length < 6) { setMessage('Use at least 6 characters for your new password.'); return; } setBusy(true); const result = await supabase?.auth.updateUser({ password }); setBusy(false); if (result?.error) setMessage(formatAuthError(result.error).message); else { setRecovery(false); setPassword(''); setMessage('Password updated.'); } };
  if (recovery && session) return <div className="account-card"><strong>Choose a new password</strong><label className="sr-only" htmlFor="account-password">New password</label><input id="account-password" type="password" placeholder="NEW PASSWORD" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><button disabled={busy} onClick={() => void updatePassword()}>{busy ? 'Working…' : 'Update password'}</button>{message && <p className="status" role="status">{message}</p>}</div>;
  if (session) return <div className="account-card"><strong>Signed in</strong><span className="muted">{session.user.email}</span><button className="secondary" onClick={() => void supabase?.auth.signOut()}>Sign out</button></div>;
  return <div className="account-card"><strong>{mode === 'sign-in' ? 'Sign in to cloud saves' : 'Create a Luna account'}</strong><label className="sr-only" htmlFor="account-email">Email address</label><input id="account-email" type="email" placeholder="EMAIL" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /><label className="sr-only" htmlFor="account-password">Password</label><input id="account-password" type="password" placeholder="PASSWORD" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /><button disabled={busy} onClick={() => void submit()}>{busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Sign up'}</button><div className="account-actions"><button type="button" className="link-button" onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>{mode === 'sign-in' ? 'Create account' : 'Have an account?'}</button>{mode === 'sign-in' && <button type="button" className="link-button" onClick={() => void reset()}>Reset password</button>}</div>{(expired || mode === 'sign-up') && <button type="button" className="link-button" disabled={busy} onClick={() => void resend()}>Resend confirmation email</button>}{message && <p className="status" role="status">{message}</p>}</div>;
}
