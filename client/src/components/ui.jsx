import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { copyText } from "../lib/format";

/* ==========================================================================
   Primitives shared across every page.
   ========================================================================== */

export function Button({
  variant = "default",
  size,
  loading = false,
  icon,
  iconRight,
  block = false,
  className = "",
  children,
  ...rest
}) {
  const classes = [
    "btn",
    variant !== "default" && `btn--${variant}`,
    size && `btn--${size}`,
    block && "btn--block",
    loading && "btn--loading",
    !children && "btn--icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} disabled={rest.disabled || loading} {...rest}>
      {icon ? <Icon name={icon} size={size === "sm" ? 13 : 15} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === "sm" ? 13 : 15} /> : null}
    </button>
  );
}

export function IconButton({ icon, label, active = false, size = 16, className = "", ...rest }) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? "icon-btn--active" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className="field">
      {label ? (
        <label className="field__label" htmlFor={htmlFor}>
          <span>{label}</span>
          {hint ? <span className="field__hint">{hint}</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="field__error">
          <Icon name="alert" size={12} />
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** forwardRef so callers (e.g. the "/" search shortcut) can focus the field. */
export const Input = forwardRef(function Input({ error, icon, action, className = "", ...rest }, ref) {
  const input = (
    <input ref={ref} className={`input ${className}`} aria-invalid={error ? "true" : undefined} {...rest} />
  );

  if (!icon && !action) return input;

  return (
    <div className="input-group">
      {icon ? (
        <span className="input-group__icon">
          <Icon name={icon} size={15} />
        </span>
      ) : null}
      {input}
      {action ? <span className="input-group__action">{action}</span> : null}
    </div>
  );
});

export const Textarea = ({ error, className = "", ...rest }) => (
  <textarea className={`textarea ${className}`} aria-invalid={error ? "true" : undefined} {...rest} />
);

export const Select = ({ className = "", children, ...rest }) => (
  <select className={`select ${className}`} {...rest}>
    {children}
  </select>
);

export const Badge = ({ tone, children, icon }) => (
  <span className={`badge ${tone ? `badge--${tone}` : ""}`}>
    {icon ? <Icon name={icon} size={10} /> : null}
    {children}
  </span>
);

export const Chip = ({ active, onRemove, onClick, children, ...rest }) => {
  const Element = onClick ? "button" : "span";
  return (
    <Element
      className={`chip ${active ? "chip--active" : ""}`}
      onClick={onClick}
      type={onClick ? "button" : undefined}
      {...rest}
    >
      {children}
      {onRemove ? (
        <span
          className="chip__remove"
          role="button"
          tabIndex={0}
          aria-label="Remove"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }
          }}
        >
          <Icon name="close" size={9} />
        </span>
      ) : null}
    </Element>
  );
};

export function Avatar({ name, email, color, size = "" }) {
  const source = name || email || "?";
  const initials = source.includes("@")
    ? source.slice(0, 2).toUpperCase()
    : source
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "?";

  return (
    <span
      className={`avatar ${size ? `avatar--${size}` : ""}`}
      style={color ? { background: `linear-gradient(135deg, ${color}, ${color}88)` } : undefined}
      title={source}
    >
      {initials}
    </span>
  );
}

export const Spinner = ({ large = false }) => (
  <span className={`spinner ${large ? "spinner--lg" : ""}`} role="status" aria-label="Loading" />
);

export const Skeleton = ({ height = 16, width = "100%", radius, style }) => (
  <span
    className="skeleton"
    style={{ display: "block", height, width, borderRadius: radius, ...style }}
    aria-hidden="true"
  />
);

export function Alert({ tone = "info", title, children, details }) {
  const icons = { info: "info", error: "alert", success: "checkCircle", warning: "alert" };
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="alert__icon">
        <Icon name={icons[tone]} size={17} />
      </span>
      <div>
        {title ? <strong className="semi">{title}</strong> : null}
        {children ? <div className={title ? "mt-1 text-sm" : "text-sm"}>{children}</div> : null}
        {details?.length ? (
          <ul className="alert__list">
            {details.map((detail, index) => (
              <li key={index}>
                {detail.field ? <span className="dim">{detail.field}: </span> : null}
                {detail.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({ icon = "files", title, children, action }) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={26} />
      </span>
      <div>
        <div className="empty__title">{title}</div>
        {children ? <p className="empty__text mt-1">{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Progress({ value = 0, tone }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`progress__fill ${tone && tone !== "ok" ? `progress__fill--${tone}` : ""}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="segmented__option"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={13} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          className="tabs__tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="dim"> {tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Modal dialog.
 *
 * Closes on Escape and on backdrop click, restores focus to whatever was
 * focused before it opened, and moves focus inside on mount so keyboard users
 * are not stranded behind the overlay.
 */
export function Modal({ open, onClose, title, subtitle, footer, children, width = "" }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = document.activeElement;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTarget = panelRef.current?.querySelector(
      "input:not([type=hidden]), textarea, select, button:not([data-autofocus=skip])"
    );
    focusTarget?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div
        className={`modal ${width ? `modal--${width}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        ref={panelRef}
      >
        <div className="modal__header">
          <div>
            <div className="modal__title">{title}</div>
            {subtitle ? <div className="modal__subtitle">{subtitle}</div> : null}
          </div>
          <IconButton icon="close" label="Close dialog" onClick={onClose} data-autofocus="skip" />
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Destructive-action confirmation. Requires typing a phrase when `confirmWord` is set. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  confirmWord,
  busy = false,
}) {
  const [typed, setTyped] = useState("");
  const inputId = useId();

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const blocked = Boolean(confirmWord) && typed.trim().toUpperCase() !== confirmWord.toUpperCase();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="narrow"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy} disabled={blocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm muted">{message}</p>
      {confirmWord ? (
        <Field label={`Type ${confirmWord} to confirm`} htmlFor={inputId}>
          <Input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={confirmWord}
            autoComplete="off"
            spellCheck="false"
          />
        </Field>
      ) : null}
    </Modal>
  );
}

/** Read-only value with a copy button that confirms in place. */
export function CopyField({ value, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="copy-field">
      <span className="copy-field__value" title={value}>
        {value}
      </span>
      <IconButton
        icon={copied ? "check" : "copy"}
        label={copied ? "Copied" : `Copy ${label || "value"}`}
        onClick={handleCopy}
        size={13}
        className={copied ? "icon-btn--active" : ""}
      />
    </div>
  );
}

/** Key/value grid used across detail views. */
export const DescriptionList = ({ items }) => (
  <dl className="dl">
    {items
      .filter((item) => item && item.value !== null && item.value !== undefined && item.value !== "")
      .map((item) => (
        <div key={item.key} style={{ display: "contents" }}>
          <dt className="dl__key">{item.key}</dt>
          <dd className="dl__val">{item.value}</dd>
        </div>
      ))}
  </dl>
);
