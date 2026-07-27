import { useCallback, useEffect, useState } from 'react';
import { teamApi } from '@/lib/teamApi';
import { ApiError } from '@/lib/apiClient';
import type { TeamMember, TeamKpis, AddTeamMemberInput, MemberStatus } from '@/types/team';

export interface UseTeamResult {
  members: TeamMember[];
  kpis: TeamKpis | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  addMember: (input: AddTeamMemberInput) => Promise<void>;
  updateRole: (id: string, role: string) => Promise<void>;
  setStatus: (id: string, status: MemberStatus) => Promise<void>;
}

/**
 * Full Team page hook -- distinct from useTeamMembers() (the original
 * lightweight name-lookup helper Inbox/LeadDrawer already depend on).
 * This one carries KPIs and the full CRUD surface the Team page needs.
 */
export function useTeam(): UseTeamResult {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [kpis, setKpis] = useState<TeamKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    teamApi.getAll()
      .then((result) => {
        if (cancelled) return;
        setMembers(result.members);
        setKpis(result.kpis);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load team members');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reloadToken]);

  const addMember = useCallback(async (input: AddTeamMemberInput) => {
    await teamApi.add(input);
    refetch();
  }, [refetch]);

  const updateRole = useCallback(async (id: string, role: string) => {
    await teamApi.updateRole(id, role);
    refetch();
  }, [refetch]);

  const setStatus = useCallback(async (id: string, status: MemberStatus) => {
    await teamApi.setStatus(id, status);
    refetch();
  }, [refetch]);

  return { members, kpis, loading, error, refetch, addMember, updateRole, setStatus };
}