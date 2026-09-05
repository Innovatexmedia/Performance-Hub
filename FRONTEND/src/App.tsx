import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/ui/Toaster';
import { Login } from '@/pages/Auth/Login';
import { Landing } from '@/pages/Landing/Landing';
import { Register } from '@/pages/Auth/Register';
import { ForgotPassword } from '@/pages/Auth/ForgotPassword';
import { ResetPassword } from '@/pages/Auth/ResetPassword';
import { VerifyEmail } from '@/pages/Auth/VerifyEmail';
import { AcceptInvitation } from '@/pages/Auth/AcceptInvitation';
import { Profile } from '@/pages/Profile/Profile';
import { RequireRole } from '@/components/auth/RequireRole';
import { ModuleGate } from '@/components/ModuleGate';
import { CaptureForm } from '@/pages/Auth/CaptureForm';
import { PublicBooking } from '@/pages/Public/PublicBooking';
import { Dashboard } from '@/pages/Dashboard/Dashboard';
import { Leads } from '@/pages/Leads/Leads';
import { WhatsAppWorkspace } from '@/pages/WhatsApp/workspace/WhatsAppWorkspace';
import { AIQualification } from '@/pages/AIQualification/AIQualification';
import { Pipeline } from '@/pages/Pipeline/Pipeline';
import { Nurture } from '@/pages/Nurture/Nurture';
import { Bookings } from '@/pages/Bookings/Bookings';
import { Calls } from '@/pages/Calls/Calls';
import { Attribution } from '@/pages/Attribution/Attribution';
import { Campaigns } from '@/pages/Campaigns/Campaigns';
import { Payments } from '@/pages/Payments/Payments';
import { Reports } from '@/pages/Reports/Reports';
import { Automations } from '@/pages/Automations/Automations';
import { Templates } from '@/pages/Templates/Templates';
import { Team } from '@/pages/Team/Team';
import { Integrations } from '@/pages/Integrations/Integrations';
import { Settings } from '@/pages/Settings/Settings';
import { SuperAdmin } from '@/pages/SuperAdmin/SuperAdmin';
import { useAuthStore } from '@/store/authStore';
import { useCurrencyStore } from '@/store/currencyStore';
import { settingsApi } from '@/lib/settingsApi';
import { applyAccentColor } from '@/utils/theme';

export default function App() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const initialize = useAuthStore((s) => s.initialize);

  // Runs once on app boot: tries a silent /auth/refresh using the httpOnly
  // cookie from a previous session. Access tokens live only in memory, so
  // without this every full-page reload would otherwise force a re-login.
  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Retints the app to the tenant's saved accent color (Settings >
  // Branding) -- keyed on tenantId so it re-fetches on login AND on
  // workspace switch (switchWorkspace/selectWorkspace change tenantId),
  // not just once at boot. Uses the narrow, ungated endpoint so this
  // works for every role, not just tenant_admin+.
  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelled = false;
    settingsApi.getBrandingPublic()
      .then(({ accent_color }) => { if (!cancelled) applyAccentColor(accent_color); })
      .catch(() => { /* keep the default indigo -- this is a nicety, not critical path */ });
    return () => { cancelled = true; };
  }, [user?.tenantId]);

  // Same reasoning as the accent-color effect above -- currency is also a
  // tenant-level setting that formatCurrency() (utils/formatters.ts) now
  // reads a default from, but the store previously only ever got
  // populated by visiting Settings. Anyone who never opened Settings in
  // a session saw every unlabeled money value fall back to USD/$, even
  // with INR genuinely configured -- this is the actual fix for that.
  useEffect(() => {
    if (!user?.tenantId) return;
    void useCurrencyStore.getState().refresh();
  }, [user?.tenantId]);

  return (
    <>
      <Routes>
        <Route path="/" element={
          status === 'idle' || status === 'loading' ? null
          : status === 'authenticated' ? <Navigate to="/dashboard" replace />
          : <Landing />
        } />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="/capture" element={<CaptureForm />} />
        <Route path="/book/:tenantId" element={<PublicBooking />} />
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/whatsapp" element={<WhatsAppWorkspace />} />
          <Route path="/qualification" element={<ModuleGate moduleKey="qualification"><AIQualification /></ModuleGate>} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/nurture" element={<ModuleGate moduleKey="nurture"><Nurture /></ModuleGate>} />
          <Route path="/bookings" element={<ModuleGate moduleKey="bookings"><Bookings /></ModuleGate>} />
          <Route path="/calls" element={<ModuleGate moduleKey="calls"><Calls /></ModuleGate>} />
          <Route path="/attribution" element={<ModuleGate moduleKey="attribution"><Attribution /></ModuleGate>} />
          <Route path="/campaigns" element={<ModuleGate moduleKey="campaigns"><Campaigns /></ModuleGate>} />
          <Route path="/payments" element={<ModuleGate moduleKey="payments"><Payments /></ModuleGate>} />
          <Route path="/reports" element={<ModuleGate moduleKey="reports"><Reports /></ModuleGate>} />
          <Route path="/automations" element={<ModuleGate moduleKey="automations"><Automations /></ModuleGate>} />
          <Route path="/templates" element={<ModuleGate moduleKey="templates"><Templates /></ModuleGate>} />
          <Route path="/team" element={<Team />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="/super-admin"
            element={<RequireRole exact="super_admin"><SuperAdmin /></RequireRole>}
          />
        </Route>
        <Route path="*" element={<Navigate to={status === 'authenticated' ? '/dashboard' : '/login'} replace />} />
      </Routes>
      <Toaster />
    </>
  );
}