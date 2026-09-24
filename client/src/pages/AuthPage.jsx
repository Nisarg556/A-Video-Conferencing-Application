import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { safeNextPath, useAuth } from '../auth/AuthContext.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

/** Sign in and sign up share one form; `mode` switches the fields and copy. */
export function AuthPage({ mode }) {
  const isSignUp = mode === 'signup';
  useDocumentTitle(isSignUp ? 'Create account' : 'Sign in');
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));

  const [fields, setFields] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'signedIn') return <Navigate to={next} replace />;

  const update = (key) => (e) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    if (fieldErrors[key]) setFieldErrors((errs) => ({ ...errs, [key]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    const errs = {};
    if (isSignUp && !fields.name.trim()) errs.name = 'Enter your name';
    if (!fields.email.trim()) errs.email = 'Enter your email';
    if (isSignUp ? fields.password.length < 8 : !fields.password) {
      errs.password = isSignUp ? 'Use at least 8 characters' : 'Enter your password';
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      if (isSignUp) await auth.signUp(fields);
      else await auth.signIn({ email: fields.email, password: fields.password });
      navigate(next, { replace: true });
    } catch (err) {
      // Server validation errors map onto fields; everything else is a banner.
      const byField = Object.fromEntries((err.details ?? []).map((d) => [d.path, d.message]));
      if (Object.keys(byField).length > 0) setFieldErrors(byField);
      else setError(err.message);
      setSubmitting(false);
    }
  }

  const switchLink = `${isSignUp ? '/login' : '/signup'}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <section className="card auth-card">
      <h1>{isSignUp ? 'Create your account' : 'Sign in'}</h1>
      <p className="muted">
        {isSignUp
          ? 'An account lets you host meetings and see your meeting history.'
          : 'Sign in to host meetings, see your history, or join meetings that require an account.'}
      </p>

      <form className="stack" onSubmit={handleSubmit} noValidate>
        {isSignUp && (
          <Field id="name" label="Name" error={fieldErrors.name} value={fields.name} onChange={update('name')} autoComplete="name" maxLength={40} />
        )}
        <Field id="email" label="Email" type="email" error={fieldErrors.email} value={fields.email} onChange={update('email')} autoComplete="email" />
        <Field
          id="password"
          label="Password"
          type="password"
          error={fieldErrors.password}
          hint={isSignUp ? 'At least 8 characters.' : undefined}
          value={fields.password}
          onChange={update('password')}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          maxLength={128}
        />

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="muted auth-switch">
        {isSignUp ? 'Already have an account?' : 'New here?'} <Link to={switchLink}>{isSignUp ? 'Sign in' : 'Create an account'}</Link>
      </p>
    </section>
  );
}

/** Labelled input whose error/hint is announced by screen readers (aria-describedby on the input). */
function Field({ id, label, error, hint, ...inputProps }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...inputProps} />
      {hint && !error && (
        <p id={`${id}-hint`} className="muted field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
