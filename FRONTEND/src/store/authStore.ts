import { create } from 'zustand';
import { authApi } from '@/lib/authApi';
import { ApiError, setAuthHandlers } from '@/lib/apiClient';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { isWorkspaceSelectionResult } from '@/types/auth';
import type { AuthUser, LoginPayload, RegisterPayload, WorkspaceOption, WorkspaceSelectionResult } from '@/types/auth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
  error: string | null;

  /**
   * Set only when login() returns the multi-workspace branch -- the UI
   * (Login page) checks this to know whether to show a workspace picker
   * instead of navigating straight into the app. Cleared once a workspace
   * is chosen via selectWorkspace().
   */
  pendingWorkspaceSelection: WorkspaceSelectionResult | null;

  /** Every workspace the current user belongs to -- populated by loadWorkspaces(), used by the Topbar switcher dropdown. */
  workspaces: WorkspaceOption[];
  /** True only while the initial fetch is actually in flight -- distinct from workspaces being an empty array after a successful fetch that found nothing. */
  workspacesLoading: boolean;

  initialize: () => Promise<void>;

  /** Throws ApiError on failure (invalid credentials, suspended account, etc.) -- callers should catch and display err.message. Returns null (not a user) when a workspace pick is required -- check pendingWorkspaceSelection in that case instead. */
  login: (payload: LoginPayload) => Promise<AuthUser | null>;

  register: (payload: RegisterPayload) => Promise<AuthUser>;

  /** Completes the session from tokens already obtained elsewhere (e.g. AcceptInvitation.tsx's real API call) -- same final step as register()'s success branch, without re-calling any auth API. */
  setSessionFromTokens: (user: AuthUser, accessToken: string) => void;

  /** Completes login after the multi-workspace branch -- uses pendingWorkspaceSelection's selectionToken. */
  selectWorkspace: (tenantId: string) => Promise<AuthUser>;

  /** Mid-session workspace switch (Topbar dropdown) -- user is already authenticated, no selectionToken needed. */
  switchWorkspace: (tenantId: string) => Promise<AuthUser>;

  /** Refreshes the workspaces list for the Topbar switcher -- safe to call any time while authenticated. */
  loadWorkspaces: () => Promise<void>;

  logout: () => Promise<void>;

  /** Revokes every active session (including this one) and clears local state -- same as logout(), but for every device, not just this one. */
  logoutAll: () => Promise<void>;

  /** Merges a partial user update into the cached session -- for Profile.tsx after a successful updateProfile() call, so the Topbar/Sidebar reflect the change immediately instead of showing stale data until a reload. */
  updateUser: (partial: Partial<AuthUser>) => void;

  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  error: null,
  pendingWorkspaceSelection: null,
  workspaces: [],
  workspacesLoading: true,

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
      const result = await authApi.login(payload);

      if (isWorkspaceSelectionResult(result)) {
        // Multi-workspace case: no token issued yet. Every account that
        // existed before this feature shipped never reaches this branch
        // (see auth.service.js login()'s comment) -- this only fires for
        // an account genuinely invited into a second workspace.
        set({ pendingWorkspaceSelection: result, status: 'unauthenticated', error: null });
        return null;
      }

      const { user, accessToken } = result;
      set({ user, accessToken, status: 'authenticated', error: null, pendingWorkspaceSelection: null });
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

  /**
   * setSessionFromTokens -- completes the session from an already-obtained
   * {user, accessToken} pair, same final step as register()'s success
   * branch. Used by AcceptInvitation.tsx, which gets real tokens back
   * directly from POST /auth/invitations/:token/accept (that endpoint
   * issues tokens the same way register() does) -- this just needs to
   * apply them to the store without re-calling any auth API.
   */
  setSessionFromTokens: (user, accessToken) => {
    set({ user, accessToken, status: 'authenticated', error: null });
    connectSocket(() => useAuthStore.getState().accessToken);
  },

  selectWorkspace: async (tenantId) => {
    const pending = get().pendingWorkspaceSelection;
    if (!pending) throw new Error('No pending workspace selection -- log in again');

    set({ status: 'loading', error: null });
    try {
      const { user, accessToken } = await authApi.switchWorkspace(tenantId, pending.selectionToken);
      set({ user, accessToken, status: 'authenticated', error: null, pendingWorkspaceSelection: null });
      connectSocket(() => useAuthStore.getState().accessToken);
      return user;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not enter that workspace. Please try again.';
      set({ status: 'unauthenticated', error: message });
      throw err;
    }
  },

  switchWorkspace: async (tenantId) => {
    try {
      const { user, accessToken } = await authApi.switchWorkspace(tenantId);
      // Reconnect the socket -- the OLD connection is still joined to the
      // OLD tenant's room (see src/realtime/socket.js), so a plain token
      // swap alone wouldn't move it into the new tenant's real-time
      // channel. Disconnecting and reconnecting re-runs the handshake
      // with the new token, joining the correct room this time.
      disconnectSocket();
      set({ user, accessToken, status: 'authenticated', error: null });
      connectSocket(() => useAuthStore.getState().accessToken);
      return user;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not switch workspace. Please try again.';
      set({ error: message });
      throw err;
    }
  },

  loadWorkspaces: async () => {
    set({ workspacesLoading: true });
    try {
      const workspaces = await authApi.listMyWorkspaces();
      set({ workspaces, workspacesLoading: false });
    } catch {
      // Non-critical -- the switcher just shows nothing if this fails, no need to surface an error toast for it.
      set({ workspacesLoading: false });
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

  logoutAll: async () => {
    try {
      await authApi.logoutAll();
    } catch {
      // Best-effort -- clear local session regardless of network/server errors.
    }
    disconnectSocket();
    set({ user: null, accessToken: null, status: 'unauthenticated', error: null });
  },

  updateUser: (partial) => {
    const current = get().user;
    if (!current) return;
    set({ user: { ...current, ...partial } });
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