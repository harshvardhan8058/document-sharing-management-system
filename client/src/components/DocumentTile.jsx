import FileGlyph from "./FileGlyph";
import { Badge, Chip, IconButton } from "./ui";
import { Icon } from "../lib/icons";
import { relativeTime, visibilityLabel, formatNumber } from "../lib/format";

/** Visibility badge tone, shared by both layouts. */
const visibilityTone = (visibility) =>
  ({ private: "private", internal: "internal", public: "public" })[visibility] || "private";

/** Card layout — the default grid view. */
export function DocumentCard({ document: doc, index = 0, onOpen, onToggleStar, onDownload, onShare }) {
  const stop = (handler) => (event) => {
    event.stopPropagation();
    handler?.();
  };

  return (
    <article
      className="panel doc-card"
      style={{ animationDelay: `${Math.min(index, 12) * 32}ms` }}
      onClick={() => onOpen?.(doc)}
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

      {doc.description ? <p className="doc-card__desc">{doc.description}</p> : null}

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
