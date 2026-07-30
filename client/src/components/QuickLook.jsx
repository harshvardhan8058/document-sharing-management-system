import { useEffect } from "react";
import DocumentPreview from "./DocumentPreview";
import FileGlyph from "./FileGlyph";
import { Badge, Button, IconButton } from "./ui";
import { Icon } from "../lib/icons";
import { useFocusTrap } from "../lib/useFocusTrap";
import { visibilityLabel } from "../lib/format";

/**
 * Space-bar preview, in the spirit of macOS Quick Look.
 *
 * Deliberately lighter than the full detail drawer: no tabs, no editing, no
 * metadata — the question it answers is "is this the file I want?", and it
 * closes on the same key that opened it. Arrow keys move to the next document
 * without leaving the overlay, so a folder can be skimmed in seconds.
 */
export default function QuickLook({ document: doc, onClose, onDownload, onOpenDetail, onPrev, onNext, position }) {
  const panelRef = useFocusTrap(true, { onEscape: onClose });

  useEffect(() => {
    const onKeyDown = (event) => {
      // Space toggles it shut again, matching how it was opened.
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        onClose?.();
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        onNext?.();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        onPrev?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onNext, onPrev]);

  if (!doc) return null;

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div
        className="quicklook"
        role="dialog"
        aria-modal="true"
        aria-label={`Quick look: ${doc.title}`}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="quicklook__header">
          <FileGlyph category={doc.file.category} extension={doc.file.extension} size="sm" />

          <div className="grow" style={{ minWidth: 0 }}>
            <div className="text-sm semi truncate">{doc.title}</div>
            <div className="text-xs dim truncate">
              {doc.file.originalName} · {doc.file.sizeLabel} · v{doc.version}
            </div>
          </div>

          <Badge tone={doc.visibility}>{visibilityLabel(doc.visibility)}</Badge>

          {position ? (
            <span className="text-xs dim nums none">
              {position.index} / {position.total}
            </span>
          ) : null}

          <span className="row gap-1 none">
            <IconButton icon="chevronLeft" label="Previous document" onClick={onPrev} disabled={!onPrev} />
            <IconButton icon="chevronRight" label="Next document" onClick={onNext} disabled={!onNext} />
            <span className="divider--v" />
            <IconButton icon="download" label="Download" onClick={() => onDownload?.(doc)} />
            <IconButton icon="external" label="Open full details" onClick={() => onOpenDetail?.(doc)} />
            <IconButton icon="close" label="Close quick look" onClick={onClose} />
          </span>
        </header>

        <div className="quicklook__body">
          <DocumentPreview document={doc} />
        </div>

        <footer className="quicklook__header" style={{ borderTop: "1px solid var(--line)", borderBottom: "none" }}>
          <span className="text-xs dim row gap-3 wrap">
            <span className="row gap-1">
              <span className="kbd">Space</span> close
            </span>
            <span className="row gap-1">
              <span className="kbd">←</span>
              <span className="kbd">→</span> browse
            </span>
            <span className="row gap-1">
              <span className="kbd">Enter</span> full details
            </span>
          </span>

          <span className="ml-auto">
            <Button variant="primary" size="sm" icon="external" onClick={() => onOpenDetail?.(doc)}>
              Open details
            </Button>
          </span>
        </footer>
      </div>
    </div>
  );
}
