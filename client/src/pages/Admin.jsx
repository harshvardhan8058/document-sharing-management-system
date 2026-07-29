import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, DescriptionList, Skeleton } from "../components/ui";
import AdminUsers from "../components/AdminUsers";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { formatBytes, formatNumber, relativeTime } from "../lib/format";

function StatTile({ label, value, meta, icon, tone }) {
  return (
    <article className="panel metric">
      <div className="metric__label">
        <Icon name={icon} size={12} />
        {label}
      </div>
      <div className={`metric__value nums ${tone || ""}`}>{value}</div>
      {meta ? <div className="metric__meta">{meta}</div> : null}
    </article>
  );
}

/** Instance-wide health. Reachable only with the admin role (enforced server-side). */
export default function Admin() {
  const toast = useToast();
  const [state, setState] = useState({ status: "loading" });
  const [purging, setPurging] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    document.title = "Instance health · DSMS";
  }, []);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [health, feed] = await Promise.all([api.stats.system(), api.stats.activity({ limit: 1 })]);
      setState({ status: "ready", health, totalEvents: feed.meta.total });
    } catch (error) {
      setState({ status: "error", error });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function purgeOrphans() {
    setPurging(true);
    try {
      const result = await api.admin.purgeOrphans();
      toast.success(`Removed ${result.removed} unreferenced file(s)`, result.label);
      await load();
    } catch (error) {
      toast.fromError(error, "Could not purge unreferenced files");
    } finally {
      setPurging(false);
    }
  }

  async function runSweep() {
    setSweeping(true);
    try {
      const result = await api.admin.runMaintenance();
      toast.success(
        "Maintenance complete",
        `${result.activity?.removed ?? 0} audit entries pruned, ${result.trash?.documents ?? 0} trashed document(s) purged.`
      );
      await load();
    } catch (error) {
      toast.fromError(error, "Maintenance failed");
    } finally {
      setSweeping(false);
    }
  }

  if (state.status === "error") {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-head__eyebrow">Administration</div>
            <h1 className="page-head__title">Instance health</h1>
          </div>
        </div>
        <Alert tone="error" title="Could not load instance health">
          {state.error.message}
        </Alert>
      </>
    );
  }

  if (state.status === "loading") {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-head__eyebrow">Administration</div>
            <h1 className="page-head__title">Instance health</h1>
          </div>
        </div>
        <div className="grid-metrics">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="panel metric col gap-3">
              <Skeleton height={11} width="45%" />
              <Skeleton height={30} width="55%" />
            </div>
          ))}
        </div>
      </>
    );
  }

  const { health } = state;
  const reconciliation = health.storageReconciliation;
  const hasOrphans = reconciliation.orphanedFiles > 0;
  const hasMissing = reconciliation.missingFiles > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Administration</div>
          <h1 className="page-head__title">Instance health</h1>
          <p className="page-head__sub">Aggregate numbers across every account on this deployment.</p>
        </div>
        <div className="page-head__actions">
          <Badge tone={health.driver === "mongo" ? "public" : "warning"} icon="shield">
            {health.driver === "mongo" ? "MongoDB" : "Local JSON store"}
          </Badge>
          <Button variant="ghost" icon="refresh" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {health.driver !== "mongo" ? (
        <Alert tone="warning" title="Running on the embedded store">
          This deployment is using the zero-config JSON driver, which is intended for local development.
          Set <span className="mono">MONGODB_URI</span> to switch to MongoDB — no code changes needed.
        </Alert>
      ) : null}

      <div className="grid-metrics">
        <StatTile label="Accounts" icon="users" value={formatNumber(health.users)} />
        <StatTile
          label="Documents"
          icon="files"
          value={formatNumber(health.documents)}
          meta={`${formatNumber(health.trashed)} in trash`}
        />
        <StatTile
          label="Active shares"
          icon="share"
          value={formatNumber(health.activeShares)}
          meta="Grants and links"
        />
        <StatTile
          label="Audit entries"
          icon="activity"
          value={formatNumber(health.auditEntries)}
          meta="Append-only"
        />
      </div>

      <div className="grid-split">
        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Storage reconciliation</div>
              <div className="panel__subtitle">Filenames on disk compared with the records that reference them</div>
            </div>
            {hasOrphans ? (
              <Button variant="outline" size="sm" icon="trash" loading={purging} onClick={purgeOrphans}>
                Purge {formatNumber(reconciliation.orphanedFiles)}
              </Button>
            ) : null}
          </div>
          <div className="panel__body col gap-4">
            <DescriptionList
              items={[
                { key: "Files referenced by records", value: formatNumber(reconciliation.referencedFiles) },
                { key: "Files present on disk", value: formatNumber(reconciliation.filesOnDisk) },
                { key: "Bytes on disk", value: health.disk.label },
                {
                  key: "Unreferenced files",
                  value: (
                    <span className={hasOrphans ? "warning" : "success"}>
                      {formatNumber(reconciliation.orphanedFiles)}
                      {reconciliation.orphanedBytes ? ` (${reconciliation.orphanedLabel})` : ""}
                    </span>
                  ),
                },
                {
                  key: "Records missing their file",
                  value: (
                    <span className={hasMissing ? "danger" : "success"}>
                      {formatNumber(reconciliation.missingFiles)}
                    </span>
                  ),
                },
              ]}
            />

            {hasMissing ? (
              <Alert tone="error" title="Some documents point at files that are gone">
                Downloads for these will fail. Restore the upload directory from a backup, or delete the
                affected records.
                {reconciliation.sample?.missing?.length ? (
                  <p className="mono text-xs mt-2 break-word">
                    {reconciliation.sample.missing.join(", ")}
                  </p>
                ) : null}
              </Alert>
            ) : null}

            {hasOrphans ? (
              <Alert tone="warning" title="Some stored files are not referenced by any record">
                Usually an interrupted cleanup. Version history is counted as referenced, so these really
                are unused and safe to purge.
              </Alert>
            ) : !hasMissing ? (
              <Alert tone="success" title="Disk and database agree">
                Every stored file is referenced, and every record has its file.
              </Alert>
            ) : null}
          </div>
        </section>

        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Retention &amp; deployment</div>
              <div className="panel__subtitle">Runtime configuration in effect</div>
            </div>
            <Button variant="outline" size="sm" icon="refresh" loading={sweeping} onClick={runSweep}>
              Run sweep
            </Button>
          </div>
          <div className="panel__body col gap-4">
            <DescriptionList
              items={[
                { key: "Persistence driver", value: health.driver },
                {
                  key: "Audit retention",
                  value: health.retention.activityDays
                    ? `${formatNumber(health.retention.activityDays)} days`
                    : "disabled — the trail grows without bound",
                },
                {
                  key: "Trash retention",
                  value: health.retention.trashDays
                    ? `${formatNumber(health.retention.trashDays)} days`
                    : "disabled — trashed files are kept forever",
                },
                {
                  key: "Sweep interval",
                  value: health.retention.sweepIntervalHours
                    ? `every ${health.retention.sweepIntervalHours}h`
                    : "manual only",
                },
                {
                  key: "Last sweep",
                  value: health.retention.lastRun
                    ? `${relativeTime(health.retention.lastRun.at)} (${health.retention.lastRun.reason})`
                    : "not run yet",
                },
                { key: "Total events logged", value: formatNumber(state.totalEvents) },
                {
                  key: "Average document size",
                  value: health.documents ? formatBytes(health.trackedBytes / health.documents) : "—",
                },
              ]}
            />

            {health.retention.lastRun?.error ? (
              <Alert tone="error" title="The last maintenance sweep failed">
                {health.retention.lastRun.error}
              </Alert>
            ) : null}
          </div>
        </section>
      </div>

      <AdminUsers />
    </>
  );
}
