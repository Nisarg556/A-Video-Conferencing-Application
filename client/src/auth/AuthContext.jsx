import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth.js';

const AuthContext = createContext(null);

/**
 * Who is signed in. The server is the authority (httpOnly cookie); this only
 * mirrors it for the UI. Anything the UI hides based on this is still checked
 * by the server.
 *
 * status: 'loading' | 'signedIn' | 'signedOut'
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    authApi
      .getMe()
      .then(({ user }) => setState({ status: 'signedIn', user }))
      .catch(() => setState({ status: 'signedOut', user: null }));
  }, []);

  const signIn = useCallback(async (credentials) => {
    const { user } = await authApi.login(credentials);
    setState({ status: 'signedIn', user });
    return user;
  }, []);

  const signUp = useCallback(async (details) => {
    const { user } = await authApi.register(details);
    setState({ status: 'signedIn', user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => {});
    setState({ status: 'signedOut', user: null });
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signUp, signOut }), [state, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export { safeNextPath } from '../lib/redirect.js';
