import { useState } from "react";
import { Button, ConfirmDialog, Field, IconButton, Input, Modal, Select } from "./ui";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useNavigate, useSearchParams } from "../lib/router";
import { formatNumber } from "../lib/format";
import { DOCUMENT_DRAG_TYPE, resolveDropIds } from "../lib/dragPayload";

const PALETTE = ["#5b8cff", "#22d3ee", "#a855f7", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#818cf8"];
const ICONS = ["files", "star", "shield", "spark", "clock", "users", "link", "grid", "activity"];

/**
 * Collections in the sidebar, with documents droppable onto them.
 *
 * Drag-and-drop is the whole point of putting these here: dragging a card onto a
 * name is faster than any menu. The drop payload is a JSON id list under a
 * custom MIME type, so a drag can carry a whole multi-selection and a drop
 * outside the app degrades to the plain-text title instead of doing something
 * surprising.
 */
export default function CollectionsNav({ selectedIds, onFiled }) {
  const {
    collections,
    unfiledCount,
    reloadCollections,
    notifyChanged,
    selectedDocumentIds,
  } = useWorkspace();
  // The library publishes its selection to the workspace; an explicit prop wins
  // so this stays usable outside the shell.
  const selection = selectedIds ?? selectedDocumentIds ?? [];
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const activeCollection = params.get("collectionId");

  const [dialog, setDialog] = useState(null); // { mode: 'create'|'edit', collection? }
  const [form, setForm] = useState({ name: "", color: PALETTE[0], icon: "files" });
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  function openCreate() {
    setForm({ name: "", color: PALETTE[collections.length % PALETTE.length], icon: "files" });
    setDialog({ mode: "create" });
  }

  function openEdit(collection) {
    setForm({ name: collection.name, color: collection.color, icon: collection.icon });
    setDialog({ mode: "edit", collection });
  }

  async function save() {
    setSaving(true);
    try {
      if (dialog.mode === "create") {
        await api.collections.create(form);
        toast.success(`Collection “${form.name}” created`);
      } else {
        await api.collections.update(dialog.collection.id, form);
        toast.success("Collection updated");
      }
      setDialog(null);
      await reloadCollections();
    } catch (error) {
      toast.fromError(error, "Could not save the collection");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const result = await api.collections.remove(pendingDelete.id);
      toast.success(
        `“${pendingDelete.name}” deleted`,
        `${formatNumber(result.documentsUnfiled)} document(s) moved to Unfiled — nothing was deleted.`
      );
      setPendingDelete(null);
      if (activeCollection === pendingDelete.id) navigate("/documents");
      await reloadCollections();
      notifyChanged();
    } catch (error) {
      toast.fromError(error, "Could not delete the collection");
    } finally {
      setSaving(false);
    }
  }

  /** Read the dragged document ids, falling back to the current selection. */
  function readDraggedIds(event) {
    return resolveDropIds(event.dataTransfer.getData(DOCUMENT_DRAG_TYPE), selection);
  }

  async function fileInto(collection, event) {
    event.preventDefault();
    setDropTarget(null);

    const ids = readDraggedIds(event);
    if (!ids.length) return;

    try {
      const result = collection
        ? await api.collections.assign(collection.id, ids)
        : await api.collections.unfile(ids);

      toast.success(
        collection
          ? `Filed ${formatNumber(result.moved)} into “${collection.name}”`
          : `Removed ${formatNumber(result.moved)} from their collection`,
        result.refused?.length ? `${result.refused.length} could not be filed.` : undefined
      );

      await reloadCollections();
      notifyChanged();
      onFiled?.();
    } catch (error) {
      toast.fromError(error, "Could not file those documents");
    }
  }

  const dropProps = (collection, key) => ({
    onDragOver: (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event) => fileInto(collection, event),
    className: `collection-link ${activeCollection === (collection?.id ?? "") ? "collection-link--active" : ""} ${
      dropTarget === key ? "drop-target--over" : ""
    }`,
  });

  return (
    <>
      <div className="nav__section row between" style={{ paddingRight: 0 }}>
        <span>Collections</span>
        <IconButton icon="plus" label="New collection" size={12} onClick={openCreate} style={{ width: 20, height: 20 }} />
      </div>

      {/* How many documents a drop here would apply to. Rendered because this
          value crossing from the library into the shell is precisely what used
          to be broken, and an invariant you cannot observe is one that breaks
          again quietly. */}
      <div className="col gap-1" data-drop-scope={selection.length}>
        {collections.map((collection) => (
          <div key={collection.id} className="row gap-1">
            <button
              type="button"
              {...dropProps(collection, collection.id)}
              onClick={() => navigate(`/documents?collectionId=${collection.id}`)}
              title={`${collection.name} — ${collection.documentCount} document(s), ${collection.totalLabel}`}
            >
              <span className="collection-dot" style={{ background: collection.color, color: collection.color }} />
              <span className="truncate">{collection.name}</span>
              <span className="collection-link__count">{collection.documentCount}</span>
            </button>

            <IconButton
              icon="settings"
              label={`Edit ${collection.name}`}
              size={12}
              onClick={() => openEdit(collection)}
              style={{ width: 22, height: 22 }}
            />
          </div>
        ))}

        {/* Unfiled is a real destination, so it accepts drops too. */}
        <button
          type="button"
          {...dropProps(null, "unfiled")}
          onClick={() => navigate("/documents?collectionId=none")}
          title="Documents not in any collection"
        >
          <span className="collection-dot" style={{ background: "var(--text-dim)", color: "transparent" }} />
          <span className="truncate dim">Unfiled</span>
          <span className="collection-link__count">{unfiledCount}</span>
        </button>

        {!collections.length ? (
          <p className="text-xs dim" style={{ padding: "var(--space-2) var(--space-3)" }}>
            Create a collection, then drag documents onto it.
          </p>
        ) : null}
      </div>

      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={dialog?.mode === "edit" ? "Edit collection" : "New collection"}
        width="narrow"
        footer={
          <>
            {dialog?.mode === "edit" ? (
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  setPendingDelete(dialog.collection);
                  setDialog(null);
                }}
              >
                Delete
              </Button>
            ) : null}
            <span className="ml-auto row gap-3">
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" icon="check" onClick={save} loading={saving} disabled={!form.name.trim()}>
                Save
              </Button>
            </span>
          </>
        }
      >
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Contracts, Q4 planning, Design…"
            maxLength={60}
          />
        </Field>

        <Field label="Colour">
          <div className="row wrap gap-2">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                aria-pressed={form.color === color}
                onClick={() => setForm({ ...form, color })}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: color,
                  border: form.color === color ? "2px solid var(--text)" : "1px solid var(--line)",
                  boxShadow: form.color === color ? `0 0 0 3px ${color}33` : "none",
                }}
              />
            ))}
          </div>
        </Field>

        <Field label="Icon">
          <Select value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
            {ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {icon}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        busy={saving}
        title="Delete this collection?"
        message={
          pendingDelete
            ? `“${pendingDelete.name}” will be removed. Its ${pendingDelete.documentCount} document(s) are NOT deleted — they move to Unfiled.`
            : ""
        }
        confirmLabel="Delete collection"
      />
    </>
  );
}
