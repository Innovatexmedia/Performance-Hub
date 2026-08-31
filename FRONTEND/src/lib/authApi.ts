import { apiClient } from '@/lib/apiClient';
import type { AuthResult, AuthUser, LoginPayload, LoginResult, RegisterPayload, WorkspaceOption, Session } from '@/types/auth';

/**
 * Thin, typed functions -- one per backend route. No business logic here;
 * authStore.ts owns state transitions, error handling, and side effects.
 * SOURCE: src/modules/auth/controllers/auth.controller.js
 */
export const authApi = {
  register: (payload: RegisterPayload) => apiClient.post<AuthResult>('/auth/register', payload),

  /** May return AuthResult (normal login) or WorkspaceSelectionResult (2+ active memberships) -- see isWorkspaceSelectionResult() to distinguish. */
  login: (payload: LoginPayload) => apiClient.post<LoginResult>('/auth/login', payload),

  /**
   * switchWorkspace -- two calling contexts, same function:
   *   - Right after login (2+ memberships): pass selectionToken, no real access token exists yet.
   *   - Mid-session (Topbar switcher): omit selectionToken -- the request's real Bearer token proves identity instead.
   */
  switchWorkspace: (tenantId: string, selectionToken?: string) =>
    apiClient.post<AuthResult>('/auth/switch-workspace', { tenantId, selectionToken }),

  /** Every workspace the currently authenticated user belongs to -- for the Topbar switcher dropdown. */
  listMyWorkspaces: () => apiClient.get<{ workspaces: WorkspaceOption[] }>('/auth/my-workspaces').then((r) => r.workspaces),

  /** Self-serve "add another company" -- tenant_owner/tenant_admin only.
   * Same AuthResult shape as switchWorkspace: caller lands in the new,
   * empty workspace immediately, no separate switch step needed. */
  createWorkspace: (name: string) => apiClient.post<AuthResult>('/auth/workspaces', { name }),

  refresh: () => apiClient.post<AuthResult>('/auth/refresh'),

  logout: () => apiClient.post<undefined>('/auth/logout'),

  me: () => apiClient.get<{ user: AuthUser }>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.patch<null>('/auth/change-password', { currentPassword, newPassword }),

  updateProfile: (data: { firstName?: string; lastName?: string; phoneNumber?: string; profileImage?: string }) =>
    apiClient.patch<{ user: AuthUser }>('/auth/profile', data).then((r) => r.user),

  forgotPassword: (email: string) => apiClient.post<null>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    apiClient.post<null>('/auth/reset-password', { token, password }),

  /** OTP variant, alongside the existing link -- see password.service.js's verifyPasswordResetOtp. Sets the new password in the same call. */
  resetPasswordWithOtp: (email: string, otp: string, password: string) =>
    apiClient.post<null>('/auth/reset-password/otp', { email, otp, password }),

  verifyEmail: (token: string) => apiClient.post<{ user: AuthUser }>('/auth/verify-email', { token }),

  /** OTP variant, alongside the existing link -- same backend document/lifecycle, see auth.service.js's verifyEmailOtp. */
  verifyEmailOtp: (email: string, otp: string) => apiClient.post<{ user: AuthUser }>('/auth/verify-email/otp', { email, otp }),

  resendVerification: () => apiClient.post<null>('/auth/resend-verification'),

  getInvitationPreview: (token: string) =>
    apiClient.get<{ email: string; role: string; tenantName: string; expiresAt: string }>(`/auth/invitations/${token}`),

  acceptInvitation: (token: string, password: string) =>
    apiClient.post<AuthResult>(`/auth/invitations/${token}/accept`, { password }),

  listSessions: () => apiClient.get<{ sessions: Session[] }>('/auth/sessions').then((r) => r.sessions),

  revokeSession: (sessionId: string) => apiClient.delete<null>(`/auth/sessions/${sessionId}`),

  logoutAll: () => apiClient.post<null>('/auth/logout-all'),
};