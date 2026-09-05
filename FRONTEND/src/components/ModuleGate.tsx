import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { usePlanTrack } from '@/hooks/usePlanTrack';
import { isModuleLocked } from './layout/nav';
import { Button } from './ui';

/**
 * ModuleGate — real, route-level enforcement of the exact same plan
 * restriction the Sidebar already uses to decide which nav links to
 * show (see layout/nav.ts's isModuleLocked). Wrap any route whose
 * module isn't available on every plan track with this.
 *
 * WHY THIS EXISTS: hiding a sidebar link was never actual access
 * control -- every one of these routes (qualification, nurture,
 * bookings, calls, attribution, campaigns, payments, reports,
 * automations, templates) was reachable by typing the URL directly,
 * with nothing in the frontend stopping it. The BACKEND already
 * rejects the underlying API calls with a 403 either way (see
 * shared/middlewares/module.middleware.js's requireModule) -- so this
 * was never a real data-security gap -- but without this, a
 * WhatsApp-only tenant hitting one of these routes directly just saw a
 * broken/empty page full of failed requests instead of a clear
 * "this needs a plan upgrade" explanation.
 *
 * Mirrors the Sidebar's own philosophy for the loading state:
 * `planTrack === undefined` (still fetching) renders children rather
 * than flashing an upgrade screen and then un-flashing it once the
 * real track loads.
 */
export function ModuleGate({ moduleKey, children }: { moduleKey: string; children: React.ReactNode }) {
  const planTrack = usePlanTrack();

  if (isModuleLocked(moduleKey, planTrack)) {
    return <UpgradeRequired />;
  }

  return <>{children}</>;
}

export function UpgradeRequired() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
        <Lock size={22} className="text-brand-600" />
      </div>
      <h2 className="text-lg font-bold text-ink-900">This feature isn't on your current plan</h2>
      <p className="mt-1.5 max-w-sm text-sm text-ink-500">
        Your WhatsApp Panel plan covers Leads, WhatsApp, and Pipeline. Upgrade to a Full Access plan to unlock this and everything else.
      </p>
      <Button className="mt-5" onClick={() => navigate('/settings?tab=billing')}>
        View plans
      </Button>
    </div>
  );
}