import { create } from 'zustand';
import { authApi } from '@/lib/authApi';
import { ApiError, setAuthHandlers } from '@/lib/apiClient';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import type { AuthUser, LoginPayload, RegisterPayload } from '@/types/auth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
  error: string | null;

  /**
   * initialize -- call ONCE on app boot. The access token lives only in
   * memory (this store), so a full page reload always starts with
   * accessToken: null. This silently calls /auth/refresh, which reads the
   * httpOnly refresh cookie set by the backend on a previous login -- if
   * it's still valid, the session is restored with no user action needed.
   * If there's no cookie (or it's expired), this resolves to
   * status: 'unauthenticated' with NO error shown -- that's just "logged out".
   */
  initialize: () => Promise<void>;

  /** Throws ApiError on failure (invalid credentials, suspended account, etc.) -- callers should catch and display err.message. */
  login: (payload: LoginPayload) => Promise<AuthUser>;

  register: (payload: RegisterPayload) => Promise<AuthUser>;

  logout: () => Promise<void>;

  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  error: null,

  initialize: async () => {
    set({ status: 'loading' });
    try {
      const { user, accessToken } = await authApi.refresh();
      set({ user, accessToken, status: 'authenticated', error: null });
      connectSocket(() => useAuthStore.getState().accessToken);
    } catch {
      // No valid session cookie -- this is the normal logged-out state, not an error.
      set({ user: null, accessToken: null, status: 'unauthenticated', error: null });
    }
  },

  login: async (payload) => {
    set({ status: 'loading', error: null });
    try {
      const { user, accessToken } = await authApi.login(payload);
      set({ user, accessToken, status: 'authenticated', error: null });
      connectSocket(() => useAuthStore.getState().accessToken);
      return user;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.';
      set({ status: 'unauthenticated', error: message });
      throw err;
    }
  },

  register: async (payload) => {
    set({ status: 'loading', error: null });
    try {
      const { user, accessToken } = await authApi.register(payload);
      set({ user, accessToken, status: 'authenticated', error: null });
      connectSocket(() => useAuthStore.getState().accessToken);
      return user;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to create account. Please try again.';
      set({ status: 'unauthenticated', error: message });
      throw err;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Best-effort -- clear local session regardless of network/server errors.
    }
    disconnectSocket();
    set({ user: null, accessToken: null, status: 'unauthenticated', error: null });
  },

  clearError: () => set({ error: null }),
}));

// Wire the auth store into apiClient's refresh-on-401 mechanism.
// See apiClient.ts's AuthHandlers doc comment for why this indirection exists.
setAuthHandlers({
  getAccessToken: () => useAuthStore.getState().accessToken,
  onTokenRefreshed: (accessToken) => useAuthStore.setState({ accessToken }),
  onRefreshFailed: () => {
    disconnectSocket();
    useAuthStore.setState({ user: null, accessToken: null, status: 'unauthenticated' });
  },
});