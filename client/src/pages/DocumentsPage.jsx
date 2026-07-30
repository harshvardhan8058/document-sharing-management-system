import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Chip, ConfirmDialog, Empty, IconButton, Input, Segmented, Select, Skeleton } from "../components/ui";
import { DocumentCard, DocumentRow, DocumentRowHeader } from "../components/DocumentTile";
import BulkBar from "../components/BulkBar";
import QuickLook from "../components/QuickLook";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useSearchParams } from "../lib/router";
import { useToast } from "../context/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useShell } from "../components/AppShell";
import { useSelection } from "../lib/useSelection";
import { categoryLabel, formatNumber, pluralize } from "../lib/format";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "largest", label: "Largest first" },
  { value: "smallest", label: "Smallest first" },
  { value: "downloads", label: "Most downloaded" },
];

const VIEW_KEY = "dsms.view";

const SCOPE_COPY = {
  all: {
    eyebrow: "Library",
    title: "All documents",
    subtitle: "Everything you own, plus anything shared with you.",
    emptyIcon: "files",
    emptyTitle: "Your library is empty",
    emptyText: "Upload a file to get started — drop it anywhere on the page or press U.",
  },
  shared: {
    eyebrow: "Collaboration",
    title: "Shared with me",
    subtitle: "Documents other people have given you access to.",
    emptyIcon: "share",
    emptyTitle: "Nothing shared with you yet",
    emptyText: "When a teammate shares a document, it will appear here.",
  },
  starred: {
    eyebrow: "Shortcuts",
    title: "Starred",
    subtitle: "The documents you flagged for quick access.",
    emptyIcon: "star",
    emptyTitle: "No starred documents",
    emptyText: "Star a document from its card or detail panel to pin it here.",
  },
  trash: {
    eyebrow: "Recoverable",
    title: "Trash",
    subtitle: "Deleted documents stay here until you remove them for good.",
    emptyIcon: "trash",
    emptyTitle: "Trash is empty",
    emptyText: "Documents you move to the trash can be restored from this view.",
  },
};

export default function DocumentsPage({ scope = "all" }) {
  const toast = useToast();
  const { revision, notifyChanged, collections, reloadCollections } = useWorkspace();
  const { openDocument, openShare, openUpload } = useShell();
  const [params, setParams] = useSearchParams();

  const copy = SCOPE_COPY[scope];
  const isTrash = scope === "trash";

  const [state, setState] = useState({ status: "loading", documents: [], meta: null, facets: null });
  const [view, setView] = useState(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [searchDraft, setSearchDraft] = useState(params.get("search") || "");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const firstRender = useRef(true);

  const search = params.get("search") || "";
  const category = params.get("category") || "";
  const tag = params.get("tag") || "";
  const visibility = params.get("visibility") || "";
  const sort = params.get("sort") || "newest";
  const page = Number(params.get("page")) || 1;
  const collectionId = params.get("collectionId") || "";
  const inContent = params.get("inContent") === "true";

  // -- selection, quick look and keyboard navigation -------------------------

  const documentIds = useMemo(() => state.documents.map((doc) => doc.id), [state.documents]);
  const selection = useSelection(documentIds);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [quickLookIndex, setQuickLookIndex] = useState(null);
  const [cursor, setCursor] = useState(-1);

  // A refetch can remove documents; a selection must not outlive them.
  useEffect(() => {
    selection.prune(documentIds);
  }, [documentIds, selection]);

  const activeCollection = collections.find((entry) => entry.id === collectionId);

  useEffect(() => {
    document.title = `${copy.title} · DSMS`;
  }, [copy.title]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* non-fatal */
    }
  }, [view]);

  // Keep the input in step when the URL changes from elsewhere (command palette,
  // topbar search, back button) without fighting the user's typing.
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  // Debounce the search box into the query string.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    if (searchDraft === search) return undefined;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (searchDraft.trim()) next.set("search", searchDraft.trim());
      else next.delete("search");
      next.delete("page");
      setParams(next);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchDraft, search, params, setParams]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: current.meta ? "refreshing" : "loading" }));
    try {
      const payload = await api.documents.list({
        scope,
        search,
        category,
        tag,
        visibility,
        sort,
        page,
        collectionId,
        inContent: inContent || undefined,
        limit: 24,
      });
      setState({ status: "ready", ...payload });
    } catch (error) {
      setState({ status: "error", error, documents: [], meta: null, facets: null });
    }
  }, [scope, search, category, tag, visibility, sort, page, collectionId, inContent]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  const clearFilters = () => {
    setSearchDraft("");
    setParams({});
  };

  const activeFilterCount = [search, category, tag, visibility, collectionId].filter(Boolean).length;

  async function toggleStar(doc) {
    // Optimistic: flip locally, roll back if the server disagrees.
    setState((current) => ({
      ...current,
      documents: current.documents.map((item) =>
        item.id === doc.id ? { ...item, isStarred: !item.isStarred } : item
      ),
    }));

    try {
      if (doc.isStarred) await api.documents.unstar(doc.id);
      else await api.documents.star(doc.id);
      notifyChanged();
    } catch (error) {
      toast.fromError(error, "Could not update the star");
      setState((current) => ({
        ...current,
        documents: current.documents.map((item) =>
          item.id === doc.id ? { ...item, isStarred: doc.isStarred } : item
        ),
      }));
    }
  }

  async function download(doc) {
    try {
      await api.documents.download(doc.id, { filename: doc.file.originalName });
      notifyChanged();
    } catch (error) {
      toast.fromError(error, "Download failed");
    }
  }

  async function restore(doc) {
    try {
      await api.documents.restore(doc.id);
      toast.success("Document restored");
      notifyChanged();
    } catch (error) {
      toast.fromError(error, "Could not restore this document");
    }
  }

  async function emptyTrash() {
    setEmptying(true);
    try {
      const result = await api.documents.emptyTrash();
      toast.success(
        `Trash emptied`,
        `${pluralize(result.deleted, "document")} and ${pluralize(result.filesRemoved, "file")} removed.`
      );
      setConfirmEmpty(false);
      notifyChanged();
    } catch (error) {
      toast.fromError(error, "Could not empty the trash");
    } finally {
      setEmptying(false);
    }
  }

  /**
   * Run a bulk action, then offer to reverse it where that is meaningful.
   *
   * Trashing many documents at once is exactly where a mis-click hurts most, so
   * it gets an Undo rather than a confirmation dialog — cheaper to dismiss, and
   * it still protects you.
   */
  async function runBulk(action, { undo } = {}) {
    const ids = selection.selectedIds;
    if (!ids.length) return;

    setBulkBusy(true);
    try {
      const result = await api.documents.bulk(action, ids);
      const noun = pluralize(result.succeeded, "document");

      if (undo) {
        toast.undoable({
          title: `${noun} ${undo.pastTense}`,
          body: result.failed?.length ? `${result.failed.length} could not be changed.` : undefined,
          onUndo: async () => {
            try {
              await api.documents.bulk(undo.action, result.succeededIds);
              toast.success(`Restored ${noun}`);
              notifyChanged();
            } catch (error) {
              toast.fromError(error, "Could not undo that");
            }
          },
        });
      } else {
        toast.success(`${noun} updated`, result.failed?.length ? `${result.failed.length} skipped.` : undefined);
      }

      selection.clear();
      notifyChanged();
    } catch (error) {
      toast.fromError(error, `Could not ${action} those documents`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function fileSelection(targetCollectionId) {
    const ids = selection.selectedIds;
    setBulkBusy(true);
    try {
      const result = targetCollectionId
        ? await api.collections.assign(targetCollectionId, ids)
        : await api.collections.unfile(ids);

      toast.success(`Filed ${pluralize(result.moved, "document")}`);
      selection.clear();
      await reloadCollections();
      notifyChanged();
    } catch (error) {
      toast.fromError(error, "Could not file those documents");
    } finally {
      setBulkBusy(false);
    }
  }

  /** Download each selected document in turn. */
  async function downloadSelection() {
    const chosen = state.documents.filter((doc) => selection.isSelected(doc.id));
    setBulkBusy(true);
    try {
      for (const doc of chosen) {
        // Sequential: a burst of parallel downloads gets throttled by the browser.
        await api.documents.download(doc.id, { filename: doc.file.originalName });
      }
      toast.success(`Downloaded ${pluralize(chosen.length, "document")}`);
      notifyChanged();
    } catch (error) {
      toast.fromError(error, "Download failed");
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Keyboard navigation over the grid.
   *
   * Arrow keys move a cursor, Space opens Quick Look, Enter opens the full
   * drawer, and ⌘/Ctrl+A selects the page — the same gestures a file manager
   * uses, so nothing here has to be learned.
   */
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      // Quick Look owns the keyboard while it is open.
      if (typing || quickLookIndex !== null) return;
      if (!state.documents.length) return;

      const columns = view === "grid" ? 4 : 1;
      const last = state.documents.length - 1;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selection.selectAll();
        return;
      }

      if (event.key === "Escape" && selection.active) {
        selection.clear();
        return;
      }

      const move = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: columns,
        ArrowUp: -columns,
      }[event.key];

      if (move !== undefined) {
        event.preventDefault();
        setCursor((current) => Math.max(0, Math.min(last, (current < 0 ? 0 : current) + move)));
        return;
      }

      if (cursor < 0) return;

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setQuickLookIndex(cursor);
      } else if (event.key === "Enter") {
        event.preventDefault();
        openDocument(state.documents[cursor].id);
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        selection.toggle(state.documents[cursor].id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.documents, view, cursor, selection, quickLookIndex, openDocument]);

  // Keep the focused card in view as the cursor moves.
  useEffect(() => {
    if (cursor < 0) return;
    const id = state.documents[cursor]?.id;
    if (!id) return;
    document.querySelector(`[data-doc-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, state.documents]);

  const categories = useMemo(
    () =>
      Object.entries(state.facets?.categories || {})
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    [state.facets]
  );

  const tags = state.facets?.tags || [];
  const meta = state.meta;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">
            {activeCollection ? "Collection" : collectionId === "none" ? "Unfiled" : copy.eyebrow}
          </div>
          <h1 className="page-head__title row gap-3" style={{ alignItems: "center" }}>
            {activeCollection ? (
              <>
                <span
                  className="collection-dot"
                  style={{ background: activeCollection.color, color: activeCollection.color, width: 12, height: 12 }}
                />
                {activeCollection.name}
              </>
            ) : collectionId === "none" ? (
              "Unfiled"
            ) : (
              copy.title
            )}
          </h1>
          <p className="page-head__sub">
            {meta ? `${formatNumber(meta.total)} ${meta.total === 1 ? "document" : "documents"} · ` : ""}
            {activeCollection
              ? activeCollection.description || "Drag documents onto a collection in the sidebar to file them."
              : collectionId === "none"
                ? "Documents that are not in any collection."
                : copy.subtitle}
          </p>
        </div>

        <div className="page-head__actions">
          <Segmented
            ariaLabel="Layout"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Grid", icon: "grid" },
              { value: "list", label: "List", icon: "list" },
            ]}
          />
          {isTrash ? (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => setConfirmEmpty(true)}
              disabled={!state.documents.length}
            >
              Empty trash
            </Button>
          ) : (
            <Button variant="primary" icon="upload" onClick={openUpload}>
              Upload
            </Button>
          )}
        </div>
      </div>

      <div className="panel panel--tight col gap-3">
        <div className="toolbar">
          <div className="toolbar__grow">
            <Input
              icon="search"
              type="search"
              placeholder={`Search ${copy.title.toLowerCase()}…`}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              aria-label="Search documents"
            />
          </div>

          <Select value={sort} onChange={(event) => setParam("sort", event.target.value)} aria-label="Sort by" style={{ width: "auto" }}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          {!isTrash && scope !== "shared" ? (
            <Select
              value={visibility}
              onChange={(event) => setParam("visibility", event.target.value)}
              aria-label="Filter by visibility"
              style={{ width: "auto" }}
            >
              <option value="">Any visibility</option>
              <option value="private">Private</option>
              <option value="internal">Team</option>
              <option value="public">Public</option>
            </Select>
          ) : null}

          {/* Searching inside files is opt-in: it is slower, and a body match is
              a different kind of result than a title match. */}
          <label className="checkbox" title="Also search the text inside documents">
            <input
              type="checkbox"
              checked={inContent}
              onChange={(event) => setParam("inContent", event.target.checked ? "true" : "")}
            />
            <span className="text-xs">Search contents</span>
          </label>

          {activeFilterCount ? (
            <Button variant="ghost" size="sm" icon="close" onClick={clearFilters}>
              Clear {activeFilterCount}
            </Button>
          ) : null}

          <IconButton
            icon="refresh"
            label="Reload"
            onClick={load}
            className={state.status === "refreshing" ? "icon-btn--active" : ""}
          />
        </div>

        {categories.length > 1 || tags.length ? (
          <div className="row wrap gap-2">
            {categories.length > 1 ? (
              <>
                <Chip active={!category} onClick={() => setParam("category", "")}>
                  All types
                </Chip>
                {categories.map((item) => (
                  <Chip
                    key={item.name}
                    active={category === item.name}
                    onClick={() => setParam("category", category === item.name ? "" : item.name)}
                  >
                    {categoryLabel(item.name)} <span className="dim">{item.count}</span>
                  </Chip>
                ))}
              </>
            ) : null}

            {tags.length ? (
              <>
                {categories.length > 1 ? <span className="divider--v" /> : null}
                {tags.slice(0, 12).map((item) => (
                  <Chip
                    key={item}
                    active={tag === item}
                    onClick={() => setParam("tag", tag === item ? "" : item)}
                  >
                    <Icon name="filter" size={10} /> {item}
                  </Chip>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {state.status === "error" ? (
        <Alert tone="error" title="Could not load documents">
          {state.error.message}
          <div className="mt-3">
            <Button variant="outline" size="sm" icon="refresh" onClick={load}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : null}

      {state.status === "loading" ? (
        <div className="grid-docs">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="panel doc-card">
              <div className="row gap-3">
                <Skeleton height={42} width={42} radius={9} />
                <div className="grow col gap-2">
                  <Skeleton height={14} width="80%" />
                  <Skeleton height={11} width="45%" />
                </div>
              </div>
              <Skeleton height={11} />
              <Skeleton height={11} width="70%" />
            </div>
          ))}
        </div>
      ) : null}

      {state.status !== "loading" && state.status !== "error" ? (
        state.documents.length ? (
          view === "grid" ? (
            <div className="grid-docs">
              {state.documents.map((doc, index) =>
                isTrash ? (
                  <TrashCard key={doc.id} document={doc} onRestore={restore} onOpen={openDocument} index={index} />
                ) : (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    index={index}
                    focused={cursor === index}
                    onOpen={openDocument}
                    onToggleStar={toggleStar}
                    onDownload={download}
                    onShare={openShare}
                    selected={selection.isSelected(doc.id)}
                    selectionMode={selection.active}
                    onToggleSelect={(target) => selection.toggle(target.id)}
                    matchSnippet={doc.matchExcerpt}
                  />
                )
              )}
            </div>
          ) : (
            <div className="panel panel--flush">
              <DocumentRowHeader />
              {state.documents.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  document={doc}
                  onOpen={openDocument}
                  onToggleStar={toggleStar}
                  onDownload={download}
                  onShare={openShare}
                />
              ))}
            </div>
          )
        ) : (
          <div className="panel">
            <Empty
              icon={activeFilterCount ? "search" : copy.emptyIcon}
              title={activeFilterCount ? "No documents match your filters" : copy.emptyTitle}
              action={
                activeFilterCount ? (
                  <Button variant="outline" icon="close" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : !isTrash && scope !== "shared" ? (
                  <Button variant="primary" icon="upload" onClick={openUpload}>
                    Upload a document
                  </Button>
                ) : null
              }
            >
              {activeFilterCount ? "Try a different search term or remove a filter." : copy.emptyText}
            </Empty>
          </div>
        )
      ) : null}

      {meta && meta.pages > 1 ? (
        <div className="pager">
          <span className="pager__info">
            Page {meta.page} of {meta.pages} · {formatNumber(meta.total)} total
          </span>
          <div className="row gap-2">
            <Button
              variant="outline"
              size="sm"
              icon="chevronLeft"
              disabled={!meta.hasPrevious}
              onClick={() => setParam("page", String(meta.page - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              iconRight="chevronRight"
              disabled={!meta.hasNext}
              onClick={() => setParam("page", String(meta.page + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <BulkBar
        count={selection.count}
        allSelected={selection.allSelected}
        collections={collections}
        busy={bulkBusy}
        scope={scope}
        onClear={selection.clear}
        onSelectAll={selection.selectAll}
        onTrash={() => runBulk("trash", { undo: { action: "restore", pastTense: "moved to trash" } })}
        onRestore={() => runBulk("restore", { undo: { action: "trash", pastTense: "restored" } })}
        onDelete={() => runBulk("delete")}
        onStar={() => runBulk("star")}
        onUnstar={() => runBulk("unstar")}
        onFile={fileSelection}
        onDownload={downloadSelection}
      />

      {quickLookIndex !== null && state.documents[quickLookIndex] ? (
        <QuickLook
          document={state.documents[quickLookIndex]}
          position={{ index: quickLookIndex + 1, total: state.documents.length }}
          onClose={() => setQuickLookIndex(null)}
          onDownload={download}
          onOpenDetail={(doc) => {
            setQuickLookIndex(null);
            openDocument(doc.id);
          }}
          onPrev={
            quickLookIndex > 0
              ? () => {
                  setQuickLookIndex(quickLookIndex - 1);
                  setCursor(quickLookIndex - 1);
                }
              : undefined
          }
          onNext={
            quickLookIndex < state.documents.length - 1
              ? () => {
                  setQuickLookIndex(quickLookIndex + 1);
                  setCursor(quickLookIndex + 1);
                }
              : undefined
          }
        />
      ) : null}

      <ConfirmDialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={emptyTrash}
        busy={emptying}
        title="Empty the trash?"
        message={`All ${state.documents.length} document(s) in your trash will be erased from disk along with every stored version. This cannot be undone.`}
        confirmLabel="Empty trash"
        confirmWord="EMPTY"
      />
    </>
  );
}

/** Trash entries get a restore affordance instead of share/star. */
function TrashCard({ document: doc, onRestore, onOpen, index }) {
  return (
    <article
      className="panel doc-card"
      style={{ animationDelay: `${Math.min(index, 12) * 32}ms` }}
      onClick={() => onOpen(doc)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(doc);
        }
      }}
    >
      <div className="doc-card__top">
        <span className="glyph">
          <Icon name="trash" size={17} />
        </span>
        <div className="grow">
          <h3 className="doc-card__title">{doc.title}</h3>
          <div className="doc-card__sub">
            <span>{doc.file.sizeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>trashed {doc.trashedAt ? new Date(doc.trashedAt).toLocaleDateString() : ""}</span>
          </div>
        </div>
      </div>

      <div className="doc-card__footer">
        <span className="text-xs dim">{doc.file.originalName}</span>
        <Button
          variant="outline"
          size="sm"
          icon="restore"
          onClick={(event) => {
            event.stopPropagation();
            onRestore(doc);
          }}
        >
          Restore
        </Button>
      </div>
    </article>
  );
}
