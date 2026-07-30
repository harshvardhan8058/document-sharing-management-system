import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Subscribe to the server's event stream.
 *
 * `EventSource` cannot send an Authorization header, so the flow is: swap the
 * bearer token for a single-use ticket, then open the stream with that ticket in
 * the URL. A ticket is worthless once used and expires in seconds, so unlike the
 * real token it is safe to have in an access log.
 *
 * That also means the browser's built-in auto-reconnect is unusable — it would
 * retry the same, now-consumed ticket forever. Reconnection is therefore handled
 * here, fetching a fresh ticket each time with exponential backoff.
 *
 * @param {boolean} enabled
 * @param {Record<string, (data: any) => void>} handlers keyed by event name
 */
export function useEventStream(enabled, handlers) {
  const [connected, setConnected] = useState(false);
  // Held in a ref so changing a handler does not tear down the stream.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      setConnected(false);
      return undefined;
    }

    let source = null;
    let retryTimer = null;
    let attempt = 0;
    let cancelled = false;

    const dispatch = (event) => (message) => {
      let payload = null;
      try {
        payload = message.data ? JSON.parse(message.data) : null;
      } catch {
        payload = null;
      }
      handlersRef.current?.[event]?.(payload);
    };

    async function open() {
      if (cancelled) return;

      try {
        const { ticket } = await api.notifications.streamTicket();
        if (cancelled) return;

        source = new EventSource(`/api/notifications/stream?ticket=${encodeURIComponent(ticket)}`);

        source.addEventListener("ready", () => {
          attempt = 0;
          setConnected(true);
        });

        for (const event of [
          "notification",
          "notifications.read",
          "comment.created",
          "comment.updated",
          "comment.deleted",
        ]) {
          source.addEventListener(event, dispatch(event));
        }

        // The server closes every stream on shutdown; reconnect to the new process.
        source.addEventListener("shutdown", () => {
          source?.close();
          setConnected(false);
          schedule();
        });

        source.onerror = () => {
          setConnected(false);
          source?.close();
          source = null;
          schedule();
        };
      } catch {
        setConnected(false);
        schedule();
      }
    }

    function schedule() {
      if (cancelled || retryTimer) return;

      // 1s, 2s, 4s … capped at 30s, so a server restart is picked up quickly
      // without a tab hammering a service that is still down.
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      attempt += 1;

      retryTimer = setTimeout(() => {
        retryTimer = null;
        open();
      }, delay);
    }

    open();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      source?.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
