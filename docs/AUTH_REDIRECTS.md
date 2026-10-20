# Luna Supabase authentication redirects

## Root cause and fix

The signup call did not provide Supabase an `emailRedirectTo`, and resend was
not implemented. Password recovery constructed a URL ad hoc. The app now uses
`src/lib/authRedirect.ts`, which resolves `import.meta.env.BASE_URL` against the
current origin. With the current Vite configuration this produces:

- Local: `http://127.0.0.1:5174/luna/`
- Pages: `https://rcguen.github.io/luna/`

Signup, resend confirmation, and password recovery all use that helper. The
Supabase client continues to use its supported `detectSessionInUrl` behavior;
the app does not mix a second custom token-exchange strategy into the flow.
Callback errors from query strings or fragments are shown safely, and only
recognized one-time auth parameters are removed with `history.replaceState`.

An `otp_expired` or invalid-link response is explained and exposes a resend
action. Password recovery presents an `updateUser({ password })` form after
Supabase emits `PASSWORD_RECOVERY`. The app only shows email-confirmed success
after Supabase reports `user.email_confirmed_at`.

## Required Supabase dashboard configuration

In Supabase Dashboard → Authentication → URL Configuration, configure:

- Site URL: `https://rcguen.github.io/luna/`
- Redirect URL: `https://rcguen.github.io/luna/**`
- Local redirect URL: `http://127.0.0.1:5174/luna/`
- Optional local host alias: `http://localhost:5174/luna/`

The dashboard must be updated manually. This repository change did not access
or modify production Supabase settings, users, email templates, or data.

The standard Supabase confirmation template should use the supplied redirect
parameter (`{{ .ConfirmationURL }}`). Do not replace the template unless the
dashboard template has been customized and is proven to discard that parameter.

An old email link can remain invalid after the redirect setting is corrected;
request a fresh confirmation email before diagnosing a new failure.
