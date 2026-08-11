import { create } from 'zustand';
import { authApi } from '@/lib/authApi';
import { ApiError, setAuthHandlers } from '@/lib/apiClient';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { toast } from '@/store/toastStore';
import { isWorkspaceSelectionResult } from '@/types/auth';
import type { AuthUser, LoginPayload, RegisterPayload, WorkspaceOption, WorkspaceSelectionResult } from '@/types/auth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

/**
 * connectSocketAndListen -- every call site that used to call connectSocket()
 * directly now goes through this instead, so the live permissions/role
 * listener is always attached exactly once per connection, regardless of
 * which of the 6 call sites (initialize/login/register/selectWorkspace/
 * switchWorkspace) established it.
 *
 * Real-time permission propagation: when an owner grants/changes a
 * permission or role for this user (see team.service.js's emitToUser),
 * this fires -- silently re-runs the token refresh (which re-derives a
 * fresh JWT from the DB, already fixed to include live permissions), so
 * the user's session picks up the change immediately, with zero manual
 * refresh or re-login needed.
 */
function connectSocketAndListen() {
  const sock = connectSocket(() => useAuthStore.getState().accessToken);
  sock.off('auth:permissions-updated');
  sock.on('auth:permissions-updated', () => {
    useAuthStore.getState().refreshPermissions();
  });
  return sock;
}

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

  /** Completes login after the multi-workspace branch -- uses pendingWorkspaceSelection's selectionToken. */
  selectWorkspace: (tenantId: string) => Promise<AuthUser>;

  /** Mid-session workspace switch (Topbar dropdown) -- user is already authenticated, no selectionToken needed. */
  switchWorkspace: (tenantId: string) => Promise<AuthUser>;

  /** Refreshes the workspaces list for the Topbar switcher -- safe to call any time while authenticated. */
  loadWorkspaces: () => Promise<void>;

  logout: () => Promise<void>;

  /**
   * Silently re-fetches the current user + a fresh access token (which
   * re-derives permissions from the DB, see token.service.js). Called
   * automatically when the server pushes 'auth:permissions-updated' over
   * the socket -- not normally something to call by hand.
   */
  refreshPermissions: () => Promise<void>;

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
      connectSocketAndListen();
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
      connectSocketAndListen();
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
      connectSocketAndListen();
      return user;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to create account. Please try again.';
      set({ status: 'unauthenticated', error: message });
      throw err;
    }
  },

  selectWorkspace: async (tenantId) => {
    const pending = get().pendingWorkspaceSelection;
    if (!pending) throw new Error('No pending workspace selection -- log in again');

    set({ status: 'loading', error: null });
    try {
      const { user, accessToken } = await authApi.switchWorkspace(tenantId, pending.selectionToken);
      set({ user, accessToken, status: 'authenticated', error: null, pendingWorkspaceSelection: null });
      connectSocketAndListen();
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
      connectSocketAndListen();
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

  refreshPermissions: async () => {
    try {
      const { user, accessToken } = await authApi.refresh();
      set({ user, accessToken });
      toast.success('Your permissions were updated', 'Some actions may now be available or restricted.');
    } catch {
      // If this silently fails (e.g. session already expired), the next
      // real request will surface the normal 401 flow -- no need to
      // interrupt the user just because this background sync didn't land.
    }
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