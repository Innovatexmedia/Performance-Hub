import { useCallback, useEffect, useState } from 'react';
import { groupsApi } from '@/lib/groupsApi';
import { ApiError } from '@/lib/apiClient';
import type { Group, GroupInput } from '@/types/group';

export interface UseGroupsResult {
  groups: Group[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createGroup: (input: GroupInput) => Promise<Group>;
  updateGroup: (id: string, patch: GroupInput) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;
  assignMembers: (id: string, leadIds: string[]) => Promise<number>;
  setMembers: (id: string, leadIds: string[]) => Promise<number>;
}

export function useGroups(): UseGroupsResult {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    groupsApi.list()
      .then((result) => { if (!cancelled) setGroups(result.data); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load groups');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reloadToken]);

  const createGroup = useCallback(async (input: GroupInput) => {
    const group = await groupsApi.create(input);
    refetch();
    return group;
  }, [refetch]);

  const updateGroup = useCallback(async (id: string, patch: GroupInput) => {
    const group = await groupsApi.update(id, patch);
    refetch();
    return group;
  }, [refetch]);

  const deleteGroup = useCallback(async (id: string) => {
    await groupsApi.delete(id);
    refetch();
  }, [refetch]);

  const assignMembers = useCallback(async (id: string, leadIds: string[]) => {
    const result = await groupsApi.assignMembers(id, leadIds);
    refetch();
    return result.matched;
  }, [refetch]);

  const setMembers = useCallback(async (id: string, leadIds: string[]) => {
    const result = await groupsApi.setMembers(id, leadIds);
    refetch();
    return result.matched;
  }, [refetch]);

  return { groups, loading, error, refetch, createGroup, updateGroup, deleteGroup, assignMembers, setMembers };
}