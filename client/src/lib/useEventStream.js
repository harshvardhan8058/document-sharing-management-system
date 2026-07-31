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
      // A tab that was hidden between scheduling a retry and running it should
      // not quietly take a connection back.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      try {
        const { ticket } = await api.notifications.streamTicket();
        if (cancelled) return;

        source = new EventSource(`/api/notifications/stream?ticket=${encodeURIComponent(ticket)}`);

        source.addEventListener("ready", () => {
          attempt = 0;
          setConnected(true);
          // Forwarded, so a consumer can catch up on whatever it missed while
          // the stream was down or the tab was hidden.
          handlersRef.current?.ready?.();
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

    /**
     * Hold the stream only while the tab is actually being looked at.
     *
     * An open EventSource occupies one of the six connections a browser will make
     * to a single origin over HTTP/1.1, and it never gives it back. Measured: with
     * five streams open from one origin, ordinary requests stop being sent at all
     * — so a handful of tabs left open would leave every one of them unable to
     * load a document.
     *
     * Nothing is lost by disconnecting a hidden tab. Notifications are persisted
     * server-side precisely so the stream is an optimisation rather than the
     * source of truth: on becoming visible again the stream reopens and the unread
     * count is re-read, which catches up anything raised in the meantime.
     *
     * The real fix for many tabs is HTTP/2, where all of this multiplexes over one
     * connection. This makes the HTTP/1.1 case survivable rather than pretending
     * it is solved.
     */
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

    function suspend() {
      clearTimeout(retryTimer);
      retryTimer = null;
      source?.close();
      source = null;
      setConnected(false);
    }

    function onVisibilityChange() {
      if (cancelled) return;
      if (visible()) {
        if (!source) {
          // Straight back in: this is a deliberate resume, not a failure.
          attempt = 0;
          open();
        }
      } else {
        suspend();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (visible()) open();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(retryTimer);
      source?.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
