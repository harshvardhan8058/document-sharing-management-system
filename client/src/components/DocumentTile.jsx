import FileGlyph from "./FileGlyph";
import { Badge, Chip, IconButton } from "./ui";
import { Icon } from "../lib/icons";
import { relativeTime, visibilityLabel, formatNumber } from "../lib/format";
import { usePointerSpotlight } from "../lib/useMotion";

/**
 * Highlight the matched term inside a content snippet.
 *
 * Built from split() rather than by injecting HTML — the term comes from user
 * input, and interpolating it into markup would be an XSS hole for the sake of
 * a bold substring.
 */
function HighlightedSnippet({ text, term }) {
  if (!text) return null;
  if (!term) return <span>{text}</span>;

  const parts = String(text).split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));

  return (
    <span>
      {parts.map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={index} className="snippet-hit">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </span>
  );
}

/** Visibility badge tone, shared by both layouts. */
const visibilityTone = (visibility) =>
  ({ private: "private", internal: "internal", public: "public" })[visibility] || "private";

/** Card layout — the default grid view. */
export function DocumentCard({
  document: doc,
  index = 0,
  onOpen,
  onToggleStar,
  onDownload,
  onShare,
  selected = false,
  selectionMode = false,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  matchSnippet,
  focused = false,
}) {
  // Pointer-tracked glow and a gentle lean away from the cursor.
  const spotlightRef = usePointerSpotlight({ tilt: 3 });

  const stop = (handler) => (event) => {
    event.stopPropagation();
    handler?.();
  };

  return (
    <article
      ref={spotlightRef}
      className={`panel doc-card spotlight spotlight-edge tilt selectable stagger-in drag-source ${
        selected ? "selected" : ""
      } ${focused ? "card-focused" : ""}`}
      style={{ "--i": index }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        // Plain text so a drop outside the app degrades to the title.
        event.dataTransfer.setData("text/plain", doc.title);
        event.dataTransfer.setData("application/x-dsms-documents", JSON.stringify([doc.id]));
        event.currentTarget.classList.add("dragging");
        onDragStart?.(doc);
      }}
      onDragEnd={(event) => {
        event.currentTarget.classList.remove("dragging");
        onDragEnd?.(doc);
      }}
      data-doc-id={doc.id}
      onClick={(event) => {
        // Cmd/Ctrl-click adds to a selection instead of opening — the standard
        // file-manager gesture.
        if (selectionMode || event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onToggleSelect?.(doc);
          return;
        }
        onOpen?.(doc);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(doc);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${doc.title}`}
    >
      {/* Selection checkbox: always present for keyboard and screen-reader use,
          visually revealed on hover or once a selection exists. */}
      <label
        className={`doc-card__select ${selected || selectionMode ? "doc-card__select--shown" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect?.(doc)}
          aria-label={`Select ${doc.title}`}
        />
      </label>

      <button
        type="button"
        className={`doc-card__star ${doc.isStarred ? "doc-card__star--on" : ""}`}
        onClick={stop(() => onToggleStar?.(doc))}
        aria-label={doc.isStarred ? "Remove star" : "Add star"}
        title={doc.isStarred ? "Starred" : "Star this document"}
      >
        <Icon name="star" size={16} strokeWidth={doc.isStarred ? 2 : 1.7} />
      </button>

      <div className="doc-card__top">
        <FileGlyph category={doc.file.category} extension={doc.file.extension} />
        <div className="grow" style={{ paddingRight: 22 }}>
          <h3 className="doc-card__title">{doc.title}</h3>
          <div className="doc-card__sub">
            <span>{doc.file.sizeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>v{doc.version}</span>
            {doc.versionCount > 1 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{doc.versionCount} versions</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* A content match earns its own line: it explains *why* this result is
          here, which a title-only list cannot. */}
      {matchSnippet ? (
        <p className="doc-card__snippet">
          <Icon name="search" size={11} />{" "}
          <HighlightedSnippet text={matchSnippet.text} term={matchSnippet.term} />
        </p>
      ) : doc.description ? (
        <p className="doc-card__desc">{doc.description}</p>
      ) : null}

      {doc.tags?.length ? (
        <div className="row wrap gap-2">
          {doc.tags.slice(0, 3).map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
          {doc.tags.length > 3 ? <Chip>+{doc.tags.length - 3}</Chip> : null}
        </div>
      ) : null}

      <div className="doc-card__footer">
        <span className="row gap-2">
          <Badge tone={visibilityTone(doc.visibility)}>{visibilityLabel(doc.visibility)}</Badge>
          {!doc.isOwner ? <Badge tone="violet">Shared</Badge> : null}
        </span>

        <span className="row gap-1">
          <span className="dim" title={`${formatNumber(doc.downloadCount)} downloads`}>
            <Icon name="download" size={12} /> {formatNumber(doc.downloadCount)}
          </span>
          <span className="divider--v" style={{ height: 14, margin: "0 4px" }} />
          <IconButton
            icon="download"
            label="Download"
            size={13}
            onClick={stop(() => onDownload?.(doc))}
            style={{ width: 26, height: 26 }}
          />
          {doc.permissions.canManage ? (
            <IconButton
              icon="share"
              label="Share"
              size={13}
              onClick={stop(() => onShare?.(doc))}
              style={{ width: 26, height: 26 }}
            />
          ) : null}
        </span>
      </div>
    </article>
  );
}

/** Dense row layout — the list view. */
export function DocumentRow({ document: doc, onOpen, onToggleStar, onDownload, onShare }) {
  const stop = (handler) => (event) => {
    event.stopPropagation();
    handler?.();
  };

  return (
    <div
      className="doc-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(doc)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(doc);
        }
      }}
      aria-label={`Open ${doc.title}`}
    >
      <FileGlyph category={doc.file.category} extension={doc.file.extension} size="sm" />

      <div className="doc-row__name">
        <div className="doc-row__title">
          {doc.isStarred ? (
            <Icon name="star" size={12} strokeWidth={2} className="warning" style={{ display: "inline" }} />
          ) : null}{" "}
          {doc.title}
        </div>
        <div className="doc-row__meta">{doc.description || doc.file.originalName}</div>
      </div>

      <div className="doc-row__meta doc-row__hide-sm">
        {doc.isOwner ? "You" : doc.ownerName || "—"}
      </div>

      <div className="doc-row__meta doc-row__hide-sm nums">{doc.file.sizeLabel}</div>

      <div className="doc-row__meta doc-row__hide-sm">{relativeTime(doc.updatedAt)}</div>

      <div className="doc-row__actions">
        <IconButton
          icon="star"
          label={doc.isStarred ? "Remove star" : "Add star"}
          size={14}
          active={doc.isStarred}
          onClick={stop(() => onToggleStar?.(doc))}
        />
        <IconButton icon="download" label="Download" size={14} onClick={stop(() => onDownload?.(doc))} />
        {doc.permissions.canManage ? (
          <IconButton icon="share" label="Share" size={14} onClick={stop(() => onShare?.(doc))} />
        ) : null}
      </div>
    </div>
  );
}

/** Column headings for the list view. */
export function DocumentRowHeader() {
  return (
    <div className="doc-row doc-row__head" aria-hidden="true">
      <span />
      <span>Name</span>
      <span className="doc-row__hide-sm">Owner</span>
      <span className="doc-row__hide-sm">Size</span>
      <span className="doc-row__hide-sm">Updated</span>
      <span />
    </div>
  );
}
