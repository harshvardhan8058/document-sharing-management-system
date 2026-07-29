import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useNavigate } from "../lib/router";
import FileGlyph from "./FileGlyph";

/**
 * Cmd/Ctrl-K palette.
 *
 * Combines static navigation commands with a live document search. Keyboard
 * only: arrows move, Enter runs, Escape closes.
 */
export default function CommandPalette({ open, onClose, onUpload, onOpenDocument, isAdmin }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [term, setTerm] = useState("");
  const [cursor, setCursor] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [searching, setSearching] = useState(false);

  const commands = useMemo(
    () =>
      [
        { id: "nav-dashboard", label: "Go to Dashboard", icon: "dashboard", run: () => navigate("/") },
        { id: "nav-documents", label: "Go to Documents", icon: "files", run: () => navigate("/documents") },
        { id: "nav-shared", label: "Go to Shared with me", icon: "share", run: () => navigate("/shared") },
        { id: "nav-starred", label: "Go to Starred", icon: "star", run: () => navigate("/starred") },
        { id: "nav-trash", label: "Go to Trash", icon: "trash", run: () => navigate("/trash") },
        { id: "nav-activity", label: "Go to Activity", icon: "activity", run: () => navigate("/activity") },
        { id: "nav-settings", label: "Go to Settings", icon: "settings", run: () => navigate("/settings") },
        isAdmin && { id: "nav-admin", label: "Go to Administration", icon: "shield", run: () => navigate("/admin") },
        { id: "action-upload", label: "Upload a document", icon: "upload", run: () => onUpload?.() },
      ].filter(Boolean),
    [navigate, onUpload, isAdmin]
  );

  const filteredCommands = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(needle));
  }, [commands, term]);

  useEffect(() => {
    if (open) {
      setTerm("");
      setCursor(0);
      setDocuments([]);
      // Focus after the entrance animation has begun, so the caret is visible.
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  // Debounced document search.
  useEffect(() => {
    if (!open || term.trim().length < 2) {
      setDocuments([]);
      return undefined;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const payload = await api.documents.list({ search: term.trim(), limit: 6 });
        setDocuments(payload.documents);
      } catch {
        setDocuments([]);
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, open]);

  const items = useMemo(
    () => [
      ...filteredCommands.map((command) => ({ kind: "command", ...command })),
      ...documents.map((document) => ({
        kind: "document",
        id: `doc-${document.id}`,
        label: document.title,
        document,
        run: () => onOpenDocument?.(document),
      })),
    ],
    [filteredCommands, documents, onOpenDocument]
  );

  useEffect(() => {
    // Keep the cursor inside the list as results change.
    setCursor((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const runItem = (item) => {
    item?.run?.();
    onClose?.();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (items.length ? (current + 1) % items.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => (items.length ? (current - 1 + items.length) % items.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(items[cursor]);
    }
  };

  const commandCount = filteredCommands.length;

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search documents or jump to a page…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Command or search"
          autoComplete="off"
          spellCheck="false"
        />

        <div className="palette__list" role="listbox">
          {commandCount ? <div className="palette__group">Actions</div> : null}

          {items.map((item, index) =>
            item.kind === "command" ? (
              <div key={item.id}>
                {index === commandCount && documents.length ? (
                  <div className="palette__group">Documents</div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={cursor === index}
                  className="palette__item"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => runItem(item)}
                >
                  <Icon name={item.icon} size={15} />
                  <span className="grow truncate">{item.label}</span>
                  <Icon name="arrowRight" size={13} />
                </button>
              </div>
            ) : (
              <div key={item.id}>
                {index === commandCount ? <div className="palette__group">Documents</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={cursor === index}
                  className="palette__item"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => runItem(item)}
                >
                  <FileGlyph
                    category={item.document.file.category}
                    extension={item.document.file.extension}
                    size="sm"
                  />
                  <span className="grow truncate">
                    <span className="semi">{item.document.title}</span>
                    <span className="dim"> · {item.document.file.sizeLabel}</span>
                  </span>
                  <Icon name="arrowRight" size={13} />
                </button>
              </div>
            )
          )}

          {!items.length ? (
            <div className="palette__item" aria-disabled="true">
              <Icon name="search" size={15} />
              <span className="grow">{searching ? "Searching…" : `No matches for "${term}"`}</span>
            </div>
          ) : null}
        </div>

        <div className="palette__footer">
          <span className="row gap-1">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span className="row gap-1">
            <span className="kbd">↵</span> select
          </span>
          <span className="row gap-1">
            <span className="kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
