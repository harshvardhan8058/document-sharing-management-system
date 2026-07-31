import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { useEventStream } from "../lib/useEventStream";

const WorkspaceContext = createContext(null);

/**
 * Cross-page workspace state: server limits, dashboard counters, collections,
 * notifications, and the live event stream.
 *
 * Two mechanisms live here on purpose:
 *
 *  - `revision` is a single counter that anything mutating documents bumps via
 *    `notifyChanged()`. Every list watches it and refetches, which keeps the
 *    sidebar counts, the dashboard and the open document list consistent without
 *    a global store or hand-written cache invalidation at each call site.
 *  - the SSE subscription, so one connection serves the whole app rather than
 *    each component opening its own.
 */
export function WorkspaceProvider({ children }) {
  const { isAuthenticated } = useAuth();

  const [limits, setLimits] = useState(null);
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [revision, setRevision] = useState(0);

  const [collections, setCollections] = useState([]);
  const [unfiledCount, setUnfiledCount] = useState(0);

  const [unread, setUnread] = useState(0);
  const [liveNotification, setLiveNotification] = useState(null);
  /** Bumped when a comment event arrives, so an open thread refetches. */
  const [commentRevision, setCommentRevision] = useState(0);

  /**
   * The library's current multi-selection, published so the sidebar can see it.
   *
   * Selection state belongs to the documents page, but the collections list that
   * documents get dropped onto lives in the shell. Without a shared value the
   * drop target cannot tell whether the card being dragged is part of a wider
   * selection, and dragging five documents would file exactly one.
   */
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const publishSelection = useCallback((ids) => {
    // Compare contents, not identity: this is called from an effect on every
    // render of the documents page and must not schedule pointless updates.
    setSelectedDocumentIds((current) => {
      if (current.length === ids.length && current.every((id, index) => id === ids[index])) return current;
      return ids;
    });
  }, []);

  const notifyChanged = useCallback(() => setRevision((value) => value + 1), []);

  // Upload limits are public and never change while the tab is open.
  useEffect(() => {
    let cancelled = false;
    api.meta
      .index()
      .then((payload) => !cancelled && setLimits(payload.limits))
      .catch(() => {
        if (!cancelled) setLimits({ maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadOverview = useCallback(async () => {
    if (!isAuthenticated) return null;
    setLoadingOverview(true);
    try {
      const payload = await api.stats.overview();
      setOverview(payload);
      setOverviewError(null);
      return payload;
    } catch (error) {
      setOverviewError(error);
      return null;
    } finally {
      setLoadingOverview(false);
    }
  }, [isAuthenticated]);

  const reloadCollections = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const payload = await api.collections.list();
      setCollections(payload.collections);
      setUnfiledCount(payload.unfiled);
    } catch {
      // Collections are a navigation aid; failing to load them must not break
      // the page around them.
    }
  }, [isAuthenticated]);

  const reloadUnread = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const { unread: count } = await api.notifications.unreadCount();
      setUnread(count);
    } catch {
      /* badge is cosmetic */
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setOverview(null);
      setCollections([]);
      setUnread(0);
      return;
    }
    reloadOverview();
    reloadCollections();
    reloadUnread();
  }, [isAuthenticated, revision, reloadOverview, reloadCollections, reloadUnread]);

  // ---------------------------------------------------------------------------
  // Live updates
  // ---------------------------------------------------------------------------

  const handlers = useRef({});
  handlers.current = useMemo(
    () => ({
      notification: (payload) => {
        if (!payload) return;
        setUnread(payload.unread ?? 0);
        // Surfaced by AppShell as a toast, then cleared.
        setLiveNotification(payload.notification);
      },
      "notifications.read": (payload) => setUnread(payload?.unread ?? 0),
      "comment.created": () => setCommentRevision((value) => value + 1),
      "comment.updated": () => setCommentRevision((value) => value + 1),
      "comment.deleted": () => setCommentRevision((value) => value + 1),

      /*
       * The stream is dropped while a tab is hidden, so anything raised in the
       * meantime was missed. Re-reading the count on reconnect is what makes that
       * safe: the notifications themselves are stored server-side, so the stream
       * only ever has to deliver the news sooner, never at all.
       */
      ready: () => reloadUnread(),
    }),
    [reloadUnread]
  );

  const { connected } = useEventStream(isAuthenticated, handlers.current);

  const value = useMemo(
    () => ({
      limits,
      overview,
      overviewError,
      loadingOverview,
      revision,
      notifyChanged,
      reloadOverview,

      collections,
      unfiledCount,
      reloadCollections,

      unread,
      setUnread,
      reloadUnread,
      liveNotification,
      clearLiveNotification: () => setLiveNotification(null),
      commentRevision,
      live: connected,

      selectedDocumentIds,
      publishSelection,

      counts: {
        documents: overview?.totals.documents ?? null,
        shared: overview?.totals.sharedWithMe ?? null,
        starred: overview?.totals.starred ?? null,
        trashed: overview?.totals.trashed ?? null,
      },
    }),
    [
      limits,
      overview,
      overviewError,
      loadingOverview,
      revision,
      notifyChanged,
      reloadOverview,
      collections,
      unfiledCount,
      reloadCollections,
      unread,
      reloadUnread,
      liveNotification,
      commentRevision,
      connected,
      selectedDocumentIds,
      publishSelection,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}
