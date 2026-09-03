import { useCallback, useEffect, useState } from 'react';
import { bookingsApi } from '@/lib/bookingsApi';
import { ApiError, type PaginationMeta } from '@/lib/apiClient';
import type { Booking, BookingInput, BookingKpis, BookingListQuery, BookingUpdateInput, RescheduleInput } from '@/types/booking';

export interface UseBookingsResult {
  bookings: Booking[];
  pagination: PaginationMeta | null;
  kpis: BookingKpis | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createBooking: (input: BookingInput) => Promise<Booking>;
  updateBooking: (id: string, input: BookingUpdateInput) => Promise<Booking>;
  updateStatus: (id: string, status: string) => Promise<Booking>;
  reschedule: (id: string, input: RescheduleInput) => Promise<Booking>;
}

export function useBookings(query: BookingListQuery): UseBookingsResult {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [kpis, setKpis] = useState<BookingKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([bookingsApi.list(query), bookingsApi.getKpis()])
      .then(([listResult, kpisResult]) => {
        if (cancelled) return;
        setBookings(listResult.data);
        setPagination(listResult.pagination);
        setKpis(kpisResult);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load bookings');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const createBooking = useCallback(async (input: BookingInput) => {
    const booking = await bookingsApi.create(input);
    refetch();
    return booking;
  }, [refetch]);

  const updateBooking = useCallback(async (id: string, input: BookingUpdateInput) => {
    const booking = await bookingsApi.update(id, input);
    refetch();
    return booking;
  }, [refetch]);

  const updateStatus = useCallback(async (id: string, status: string) => {
    const booking = await bookingsApi.updateStatus(id, status);
    refetch();
    return booking;
  }, [refetch]);

  const reschedule = useCallback(async (id: string, input: RescheduleInput) => {
    const booking = await bookingsApi.reschedule(id, input);
    refetch();
    return booking;
  }, [refetch]);

  return { bookings, pagination, kpis, loading, error, refetch, createBooking, updateBooking, updateStatus, reschedule };
}