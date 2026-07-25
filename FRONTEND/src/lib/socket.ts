import { io, type Socket } from 'socket.io-client';

/**
 * SOURCE: src/realtime/socket.js (backend)
 *
 * The backend's Socket.io server attaches to the SAME http.Server as the
 * REST API -- same host/port, no separate real-time server. Derived from
 * VITE_API_URL by stripping the trailing /api, since Socket.io connects to
 * the server root, not an API path.
 */
const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4001/api';
const SOCKET_URL = API_URL.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

/**
 * connectSocket -- call once after a successful login (or on silent
 * session restore). `getToken` is called FRESH on every connection and
 * reconnection attempt (socket.io-client supports `auth` as a function for
 * exactly this reason) -- so a token refreshed after the initial connect
 * is still picked up correctly if the socket ever has to reconnect,
 * instead of retrying with a stale captured value.
 */
export function connectSocket(getToken: () => string | null): Socket {
  if (socket?.connected) return socket;

  socket = io(SOCKET_URL, {
    auth: (cb) => cb({ token: getToken() ?? '' }),
    withCredentials: true,
    autoConnect: true,
  });

  return socket;
}

/** disconnectSocket -- call on logout, so a stale/expired token isn't left connected. */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}