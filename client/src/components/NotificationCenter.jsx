import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, IconButton, Spinner } from "./ui";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { relativeTime } from "../lib/format";

const ICON_FOR_TYPE = {
  "document.shared": "share",
  "document.share_revoked": "lock",
  "comment.created": "activity",
  "comment.reply": "activity",
  "comment.mention": "users",
  "document.version_added": "upload",
  "quota.warning": "alert",
};

/**
 * The notification bell and its panel.
 *
 * The unread count comes from the shared workspace state, which the SSE stream
 * keeps current — so the badge moves the moment something happens rather than on
 * the next poll. The list itself is fetched when the panel opens, because it is
 * only needed then.
 */
export default function NotificationCenter({ onOpenDocument }) {
  const { unread, setUnread, reloadUnread, live } = useWorkspace();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "idle", notifications: [] });
  const [busy, setBusy] = useState(false);
  const containerRef = useRef(null);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const payload = await api.notifications.list({ limit: 25 });
      setState({ status: "ready", notifications: payload.notifications });
      setUnread(payload.unread);
    } catch (error) {
      setState({ status: "error", notifications: [], error });
    }
  }, [setUnread]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Keep the list fresh while it is open and something arrives.
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: react to the badge moving
  }, [unread]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function openNotification(notification) {
    setOpen(false);
    if (!notification.read) {
      await api.notifications.markRead(notification.id).catch(() => {});
      reloadUnread();
    }
    if (notification.documentId) onOpenDocument?.(notification.documentId);
  }

  async function markAll() {
    setBusy(true);
    try {
      await api.notifications.markAllRead();
      setUnread(0);
      await load();
    } catch (error) {
      toast.fromError(error, "Could not mark them read");
    } finally {
      setBusy(false);
    }
  }

  async function clearRead() {
    setBusy(true);
    try {
      const result = await api.notifications.clearRead();
      toast.success(`Cleared ${result.removed} notification${result.removed === 1 ? "" : "s"}`);
      await load();
    } catch (error) {
      toast.fromError(error, "Could not clear them");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notif-button relative" ref={containerRef}>
      <IconButton
        icon="activity"
        label={unread ? `Notifications (${unread} unread)` : "Notifications"}
        onClick={() => setOpen((value) => !value)}
        active={open}
        aria-expanded={open}
      />

      {unread > 0 ? (
        <span className="notif-badge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}

      {/* Announced politely so a screen reader hears the count change without
          being interrupted mid-sentence. */}
      <span className="sr-only" aria-live="polite">
        {unread > 0 ? `${unread} unread notifications` : "No unread notifications"}
      </span>

      {open ? (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="panel__header">
            <div>
              <div className="panel__title">Notifications</div>
              <div className="panel__subtitle row gap-2">
                <span className={`live-dot ${live ? "" : "live-dot--off"}`} />
                {live ? "Live" : "Reconnecting…"}
              </div>
            </div>
            <div className="row gap-1">
              {unread > 0 ? (
                <Button variant="ghost" size="sm" onClick={markAll} loading={busy}>
                  Mark all read
                </Button>
              ) : null}
              <IconButton icon="close" label="Close notifications" onClick={() => setOpen(false)} />
            </div>
          </div>

          <div className="scroll-y grow">
            {state.status === "loading" ? (
              <div className="row center" style={{ padding: "var(--space-6)" }}>
                <Spinner />
              </div>
            ) : state.notifications.length ? (
              state.notifications.map((notification) => (
                <button
                  type="button"
                  key={notification.id}
                  className={`notif-item relative ${notification.read ? "" : "notif-item--unread"}`}
                  onClick={() => openNotification(notification)}
                >
                  <span
                    className="avatar avatar--sm"
                    style={
                      notification.actor
                        ? {
                            background: `linear-gradient(135deg, ${notification.actor.accentColor}, ${notification.actor.accentColor}88)`,
                          }
                        : undefined
                    }
                  >
                    <Icon name={ICON_FOR_TYPE[notification.type] || "info"} size={12} />
                  </span>

                  <span style={{ minWidth: 0 }}>
                    <span className="notif-item__title">{notification.title}</span>
                    {notification.body ? (
                      <span className="notif-item__body">{notification.body}</span>
                    ) : null}
                    <span className="timeline__time" style={{ display: "block", marginTop: 3 }}>
                      {relativeTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <Empty icon="activity" title="Nothing yet">
                Shares, comments and mentions will appear here.
              </Empty>
            )}
          </div>

          {state.notifications.some((notification) => notification.read) ? (
            <div className="palette__footer">
              <button type="button" className="link-quiet text-xs" onClick={clearRead} disabled={busy}>
                Clear read notifications
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
