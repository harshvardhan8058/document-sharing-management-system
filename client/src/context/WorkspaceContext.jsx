import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

const WorkspaceContext = createContext(null);

/**
 * Cross-page workspace state: server limits, dashboard counters, and a single
 * `revision` counter.
 *
 * Anything that mutates documents calls `notifyChanged()`; every list watches
 * `revision` and refetches. That keeps sidebar counts, the dashboard and the
 * open document list consistent after an upload or a delete without a global
 * store or manual cache invalidation at each call site.
 */
export function WorkspaceProvider({ children }) {
  const { isAuthenticated } = useAuth();

  const [limits, setLimits] = useState(null);
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [revision, setRevision] = useState(0);

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

  useEffect(() => {
    if (!isAuthenticated) {
      setOverview(null);
      return;
    }
    reloadOverview();
  }, [isAuthenticated, revision, reloadOverview]);

  const value = useMemo(
    () => ({
      limits,
      overview,
      overviewError,
      loadingOverview,
      revision,
      notifyChanged,
      reloadOverview,
      counts: {
        documents: overview?.totals.documents ?? null,
        shared: overview?.totals.sharedWithMe ?? null,
        starred: overview?.totals.starred ?? null,
        trashed: overview?.totals.trashed ?? null,
      },
    }),
    [limits, overview, overviewError, loadingOverview, revision, notifyChanged, reloadOverview]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}
