import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Chip, ConfirmDialog, Empty, IconButton, Segmented, Select, Skeleton } from "../components/ui";
import { DocumentCard, DocumentRow, DocumentRowHeader } from "../components/DocumentTile";
import BulkBar from "../components/BulkBar";
import QuickLook from "../components/QuickLook";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useParams, useSearchParams } from "../lib/router";
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
  { value: "downloads-asc", label: "Least downloaded" },
  { value: "updated-asc", label: "Least recently updated" },
];

const VIEW_KEY = "dsms.view";
const DENSITY_KEY = "dsms.density";

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
  const { revision, notifyChanged, collections, reloadCollections, publishSelection } = useWorkspace();
  const { openDocument, openShare, openUpload } = useShell();
  const [params, setParams] = useSearchParams();
  const routeParams = useParams();

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

  /**
   * Row height. A preference, so it is remembered rather than re-chosen.
   *
   * People who live in a file list want to see thirty rows at once; people who
   * visit it occasionally want the extra breathing room. Applied as a data
   * attribute driving custom properties, so grid and table stay in step instead
   * of each growing their own spacing rules.
   */
  const [density, setDensity] = useState(() => {
    try {
      return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_KEY, density);
    } catch {
      /* a blocked localStorage should not break the page */
    }
    document.documentElement.dataset.density = density;
    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [density]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);

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

  /**
   * Publish the selection to the shell so the collections in the sidebar can
   * tell that a dragged card represents more than itself. Cleared on unmount so
   * a stale selection cannot follow the user to another route.
   */
  useEffect(() => {
    publishSelection(selection.selectedIds);
  }, [selection.selectedIds, publishSelection]);

  useEffect(() => () => publishSelection([]), [publishSelection]);

  /** `/documents/:id` opens that document's drawer over the library. */
  useEffect(() => {
    if (routeParams?.id) openDocument(routeParams.id);
  }, [routeParams?.id, openDocument]);
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

  /*
   * The search term is read from the URL and owned by the field in the header.
   * This page used to keep its own draft and debounce it into the query string,
   * which is what made two boxes possible in the first place.
   */

  /**
   * Identity of the current query. Two loads with the same key are the same
   * question asked twice; a different key is a different question.
   */
  /*
   * Deliberately excludes `sort`.
   *
   * Re-ordering asks for the same documents in a different order, so the rows on
   * screen are still the right answer and blanking them is a worse experience
   * than briefly showing a stale order — especially in the table, where clicking
   * a column made the whole table vanish and reappear. Anything that can change
   * *which* documents come back still clears the list.
   */
  const queryKey = useMemo(
    () => JSON.stringify({ scope, search, category, tag, visibility, page, collectionId, inContent }),
    [scope, search, category, tag, visibility, page, collectionId, inContent]
  );
  const loadedKey = useRef(null);

  const load = useCallback(async () => {
    /*
     * Re-running the same query keeps its results on screen — that is what makes
     * a background refresh unobtrusive. A *different* query must clear them,
     * because otherwise the previous scope's documents sit under the new
     * heading: clicking "Starred" showed five unstarred documents until the
     * fetch landed, with nothing on screen to say it was still loading.
     */
    setState((current) =>
      loadedKey.current === queryKey && current.meta
        ? { ...current, status: "refreshing" }
        : { status: "loading", documents: [], meta: null, facets: current.facets }
    );
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
      loadedKey.current = queryKey;
      setState({ status: "ready", ...payload });
    } catch (error) {
      loadedKey.current = null;
      setState({ status: "error", error, documents: [], meta: null, facets: null });
    }
  }, [queryKey, scope, search, category, tag, visibility, sort, page, collectionId, inContent]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const [showAllTags, setShowAllTags] = useState(false);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  /**
   * Drop the filters, keep the way you are looking at things.
   *
   * `setParams({})` also reset the sort order, which is not a filter: asking for
   * "largest first" and then clearing a tag would silently put you back on
   * "newest first". Sort and page survive; page resets because the results are
   * different now.
   */
  const clearFilters = () => {
    const next = new URLSearchParams();
    const keptSort = params.get("sort");
    if (keptSort) next.set("sort", keptSort);
    setParams(next);
  };

  /**
   * Each active filter, with the means to remove just that one.
   *
   * Built here rather than in the markup so the summary and the "clear" logic
   * cannot disagree about what counts as a filter — the count in the toolbar
   * already listed five things while the reset button cleared every query
   * parameter including the sort order.
   */
  const activeFilters = useMemo(() => {
    const list = [];
    const drop = (key) => () => setParam(key, "");

    if (search) list.push({ key: "search", label: "matching", value: `“${search}”`, clear: drop("search") });
    if (category) list.push({ key: "category", label: "type", value: categoryLabel(category), clear: drop("category") });
    if (tag) list.push({ key: "tag", label: "tag", value: tag, clear: drop("tag") });
    if (visibility) {
      const labels = { private: "Private", internal: "Team", public: "Public" };
      list.push({ key: "visibility", label: "visibility", value: labels[visibility] || visibility, clear: drop("visibility") });
    }
    if (collectionId) {
      const found = collections.find((entry) => entry.id === collectionId);
      list.push({
        key: "collection",
        label: "in",
        value: found ? found.name : "collection",
        clear: drop("collectionId"),
      });
    }
    if (inContent) {
      list.push({ key: "inContent", label: "searching", value: "file contents", clear: drop("inContent") });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, tag, visibility, collectionId, inContent, collections, params]);

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

  /* Declared here, immediately after `tags`: these derive from it, and hoisting
     them to the top of the component put a `const` reference before its
     initialiser, which is a ReferenceError at render rather than a lint nit. */
  const TAG_LIMIT = 6;
  const visibleTags = showAllTags ? tags : tags.slice(0, TAG_LIMIT);
  const hiddenTagCount = Math.max(0, tags.length - TAG_LIMIT);
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

          {/* Spelled out rather than an icon: the only sensible glyphs for
              density are rows and a grid, and both are already taken by the
              layout switch immediately to the left. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
            aria-pressed={density === "compact"}
            title="Row height"
          >
            {density === "compact" ? "Compact" : "Comfortable"}
          </Button>
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

          {/* Clearing lives with the chips that show what would be cleared,
              immediately below. Two "clear" controls side by side is the same
              duplication as the two search boxes. */}

          <IconButton
            icon="refresh"
            label="Reload"
            onClick={load}
            className={state.status === "refreshing" ? "icon-btn--active" : ""}
          />
        </div>

        {/*
          What is currently narrowing the list, and how to undo any one of it.
          Before this the only affordance was "Clear 3", which is all-or-nothing:
          you could see that three filters were active but not which, and undoing
          one meant clearing everything and starting again.
        */}
        {activeFilters.length ? (
          <div className="row wrap gap-2 items-center filter-summary">
            <span className="text-xs dim">Filtered by</span>
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className="chip chip--active chip--removable"
                onClick={filter.clear}
                title={`Remove this filter`}
              >
                <span className="dim">{filter.label}</span> {filter.value}
                <Icon name="close" size={11} strokeWidth={2.5} />
              </button>
            ))}
            {activeFilters.length > 1 ? (
              <button type="button" className="link-quiet text-xs" onClick={clearFilters}>
                Clear all
              </button>
            ) : null}
          </div>
        ) : null}

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
                {/*
                  Tags are collapsed past a handful. Fifteen of them at identical
                  weight wrapped onto a second row and read as decoration rather
                  than as controls — and the count that matters, the type
                  breakdown, was lost in the middle of it.
                */}
                {visibleTags.map((item) => (
                  <Chip
                    key={item}
                    active={tag === item}
                    onClick={() => setParam("tag", tag === item ? "" : item)}
                  >
                    <Icon name="filter" size={10} /> {item}
                  </Chip>
                ))}
                {hiddenTagCount ? (
                  <button
                    type="button"
                    className="link-quiet text-xs"
                    onClick={() => setShowAllTags((open) => !open)}
                    aria-expanded={showAllTags}
                  >
                    {showAllTags ? "Fewer tags" : `+${hiddenTagCount} more`}
                  </button>
                ) : null}
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

      {/* Placeholders mirror the view you are actually in, so switching scope
          does not also change the shape of the page under you. */}
      {state.status === "loading" ? (
        view === "grid" ? (
          <div className="grid-docs" aria-busy="true" aria-label="Loading documents">
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
        ) : (
          <div className="col gap-2" aria-busy="true" aria-label="Loading documents">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="panel row gap-3 items-center" style={{ padding: "14px 16px" }}>
                <Skeleton height={34} width={34} radius={9} />
                <div className="grow col gap-2">
                  <Skeleton height={13} width={`${58 - (index % 3) * 9}%`} />
                  <Skeleton height={10} width="26%" />
                </div>
                <Skeleton height={10} width={64} />
                <Skeleton height={22} width={70} radius={999} />
              </div>
            ))}
          </div>
        )
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
                    /* Dragging a card that is part of a selection drags the
                       whole selection. Decided here, where the selection lives,
                       and carried on the drag itself. */
                    dragIds={selection.isSelected(doc.id) ? selection.selectedIds : [doc.id]}
                    matchSnippet={doc.matchExcerpt}
                  />
                )
              )}
            </div>
          ) : (
            <div className="panel panel--flush" role="table" aria-label={copy.title} aria-rowcount={meta?.total ?? -1}>
              <DocumentRowHeader
                sort={sort}
                onSort={(next) => setParam("sort", next)}
                allSelected={selection.allSelected}
                someSelected={selection.active}
                onToggleAll={() => (selection.allSelected ? selection.clear() : selection.selectAll())}
              />
              {state.documents.map((doc, index) => (
                <DocumentRow
                  key={doc.id}
                  document={doc}
                  focused={cursor === index}
                  onOpen={openDocument}
                  onToggleStar={toggleStar}
                  onDownload={download}
                  onShare={openShare}
                  selected={selection.isSelected(doc.id)}
                  selectionMode={selection.active}
                  onToggleSelect={(target) => selection.toggle(target.id)}
                  dragIds={selection.isSelected(doc.id) ? selection.selectedIds : [doc.id]}
                />
              ))}
            </div>
          )
        ) : (
          <div className="panel">
            <Empty
              icon={activeFilters.length ? "search" : copy.emptyIcon}
              title={activeFilters.length ? "No documents match your filters" : copy.emptyTitle}
              action={
                activeFilters.length ? (
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
              {activeFilters.length ? "Try a different search term or remove a filter." : copy.emptyText}
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
