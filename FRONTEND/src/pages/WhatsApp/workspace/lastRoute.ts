const KEY = 'innovatex:last-route-before-whatsapp';
const FALLBACK = '/dashboard';

export function recordRoute(pathname: string, search: string): void {
  if (pathname.startsWith('/whatsapp')) return; // never record ourselves
  try {
    sessionStorage.setItem(KEY, pathname + search);
  } catch {
    /* sessionStorage unavailable (e.g. private mode edge cases) -- fall back silently */
  }
}

export function getLastRoute(): string {
  try {
    return sessionStorage.getItem(KEY) || FALLBACK;
  } catch {
    return FALLBACK;
  }
}