import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, DescriptionList, Skeleton } from "../components/ui";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { formatBytes, formatNumber } from "../lib/format";

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
  const [state, setState] = useState({ status: "loading" });

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
  const hasOrphans = health.orphanedFiles > 0;
  const driftBytes = Math.abs(health.disk.bytes - health.trackedBytes);

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
              <div className="panel__subtitle">Database records compared with the files on disk</div>
            </div>
          </div>
          <div className="panel__body col gap-4">
            <DescriptionList
              items={[
                { key: "Tracked in database", value: health.trackedLabel },
                { key: "Present on disk", value: `${health.disk.label} across ${formatNumber(health.disk.files)} files` },
                {
                  key: "Difference",
                  value: (
                    <span className={driftBytes > 1024 * 1024 ? "warning" : "success"}>
                      {formatBytes(driftBytes)}
                    </span>
                  ),
                },
                {
                  key: "Unreferenced files",
                  value: (
                    <span className={hasOrphans ? "warning" : "success"}>
                      {formatNumber(health.orphanedFiles)}
                    </span>
                  ),
                },
              ]}
            />

            {hasOrphans ? (
              <Alert tone="warning" title="Some stored files are not referenced by any document">
                This usually means a cleanup was interrupted. Version history also counts here, so a value
                close to the number of extra versions is expected rather than a problem.
              </Alert>
            ) : (
              <Alert tone="success" title="Disk and database agree">
                Every stored file is referenced by a document record.
              </Alert>
            )}
          </div>
        </section>

        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Deployment</div>
              <div className="panel__subtitle">Runtime configuration in effect</div>
            </div>
          </div>
          <div className="panel__body">
            <DescriptionList
              items={[
                { key: "Persistence driver", value: health.driver },
                { key: "Total events logged", value: formatNumber(state.totalEvents) },
                { key: "Documents per account", value: health.users ? (health.documents / health.users).toFixed(1) : "0" },
                {
                  key: "Average document size",
                  value: health.documents ? formatBytes(health.trackedBytes / health.documents) : "—",
                },
              ]}
            />
          </div>
        </section>
      </div>
    </>
  );
}
