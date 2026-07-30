import { useState } from "react";
import { Button, IconButton, Select } from "./ui";
import { Icon } from "../lib/icons";
import { pluralize } from "../lib/format";

/**
 * Actions for the current multi-selection.
 *
 * Sticky to the bottom of the content column rather than fixed to the viewport:
 * it belongs to the list it acts on, and a fixed bar would hover over unrelated
 * pages during a route change.
 */
export default function BulkBar({
  count,
  collections = [],
  busy = false,
  scope = "all",
  onClear,
  onSelectAll,
  allSelected,
  onTrash,
  onRestore,
  onDelete,
  onStar,
  onUnstar,
  onFile,
  onDownload,
}) {
  const [collectionId, setCollectionId] = useState("");

  if (!count) return null;

  const inTrash = scope === "trash";

  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <span className="bulk-bar__count">
        <Icon name="check" size={12} />
        {count}
      </span>

      <span className="text-sm muted">{pluralize(count, "document")} selected</span>

      <button type="button" className="link-quiet text-xs" onClick={allSelected ? onClear : onSelectAll}>
        {allSelected ? "Clear" : "Select all on this page"}
      </button>

      <span className="divider--v" />

      {inTrash ? (
        <>
          <Button variant="outline" size="sm" icon="restore" onClick={onRestore} loading={busy}>
            Restore
          </Button>
          <Button variant="danger" size="sm" icon="trash" onClick={onDelete} loading={busy}>
            Delete forever
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" icon="download" onClick={onDownload} disabled={busy}>
            Download
          </Button>
          <Button variant="ghost" size="sm" icon="star" onClick={onStar} disabled={busy}>
            Star
          </Button>
          <Button variant="ghost" size="sm" onClick={onUnstar} disabled={busy}>
            Unstar
          </Button>

          {collections.length ? (
            <span className="row gap-2">
              <Select
                aria-label="File into a collection"
                value={collectionId}
                style={{ width: "auto", height: 31, fontSize: "var(--fs-xs)" }}
                onChange={(event) => {
                  const value = event.target.value;
                  setCollectionId("");
                  if (value) onFile?.(value === "none" ? null : value);
                }}
              >
                <option value="">File into…</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
                <option value="none">Remove from collection</option>
              </Select>
            </span>
          ) : null}

          <Button variant="danger" size="sm" icon="trash" onClick={onTrash} loading={busy}>
            Trash
          </Button>
        </>
      )}

      <span className="ml-auto">
        <IconButton icon="close" label="Clear selection" onClick={onClear} />
      </span>
    </div>
  );
}
