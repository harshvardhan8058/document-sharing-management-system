import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icons";

const ToastContext = createContext(null);

const ICONS = {
  success: "checkCircle",
  error: "alert",
  warning: "alert",
  info: "info",
};

const DEFAULT_DURATION = { success: 3600, info: 3600, warning: 5200, error: 6500 };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const entry = { id, tone: "info", ...toast };

      setToasts((current) => {
        // Cap the stack so a loop of failures cannot bury the interface.
        const next = [...current, entry];
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });

      const duration = entry.duration ?? DEFAULT_DURATION[entry.tone] ?? 4000;
      if (duration !== Infinity) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (title, body) => push({ tone: "success", title, body }),
      error: (title, body) => push({ tone: "error", title, body }),
      warning: (title, body) => push({ tone: "warning", title, body }),
      info: (title, body) => push({ tone: "info", title, body }),

      /**
       * A toast offering to reverse what just happened.
       *
       * Held on screen much longer than a plain confirmation, because the whole
       * point is that the user has time to notice and change their mind.
       */
      undoable: ({ title, body, onUndo, label = "Undo", duration = 9000 }) =>
        push({ tone: "success", title, body, duration, action: { label, onClick: onUndo } }),
      /**
       * Report a thrown ApiError with its field details flattened into the body,
       * so validation failures are actionable without opening dev tools.
       */
      fromError: (error, fallback = "Something went wrong") => {
        const details = (error?.details || [])
          .map((detail) => detail.message && detail.field ? `${detail.field}: ${detail.message}` : detail.message)
          .filter(Boolean)
          .join(" · ");
        return push({ tone: "error", title: error?.message || fallback, body: details || undefined });
      },
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <span className="toast__icon">
              <Icon name={ICONS[toast.tone] || "info"} size={17} />
            </span>
            <div>
              <div className="toast__title">{toast.title}</div>
              {toast.body ? <div className="toast__body">{toast.body}</div> : null}

              {/* An inline action turns a toast into a reversal path — "Undo"
                  is far kinder than a confirmation dialog before every delete. */}
              {toast.action ? (
                <button
                  type="button"
                  className="toast__action"
                  onClick={async () => {
                    dismiss(toast.id);
                    await toast.action.onClick?.();
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 24, height: 24 }}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
