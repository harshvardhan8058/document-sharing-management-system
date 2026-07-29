import { useEffect } from "react";
import { Alert, Badge, Button, Empty, Skeleton } from "../components/ui";
import { CategoryBreakdown, DayBars, Sparkline, StorageRing } from "../components/charts";
import FileGlyph from "../components/FileGlyph";
import { iconForAction } from "../components/DocumentDrawer";
import { Icon } from "../lib/icons";
import { Link } from "../lib/router";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useShell } from "../components/AppShell";
import { compactNumber, formatNumber, relativeTime, usageTone, visibilityLabel } from "../lib/format";

function MetricTile({ label, icon, value, meta, spark, sparkColor, accent }) {
  return (
    <article className="panel metric">
      {accent ? <span className="metric__orb" style={{ background: accent }} /> : null}
      <div className="metric__label">
        <Icon name={icon} size={12} />
        {label}
      </div>
      <div className="metric__value nums">{value}</div>
      {meta ? <div className="metric__meta">{meta}</div> : null}
      {spark?.length ? (
        <div className="metric__spark">
          <Sparkline points={spark} color={sparkColor} />
        </div>
      ) : null}
    </article>
  );
}

function LoadingDashboard() {
  return (
    <>
      <div className="grid-metrics">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="panel metric col gap-3">
            <Skeleton height={11} width="45%" />
            <Skeleton height={30} width="60%" />
            <Skeleton height={11} width="35%" />
          </div>
        ))}
      </div>
      <div className="grid-split">
        <div className="panel panel--pad col gap-4">
          <Skeleton height={14} width="30%" />
          <Skeleton height={132} />
        </div>
        <div className="panel panel--pad col gap-4">
          <Skeleton height={14} width="40%" />
          <Skeleton height={148} radius={999} width={148} style={{ margin: "0 auto" }} />
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { overview, overviewError, loadingOverview, reloadOverview } = useWorkspace();
  const { openUpload, openDocument } = useShell();

  useEffect(() => {
    document.title = "Dashboard · DSMS";
  }, []);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 5) return "Working late";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  })();

  if (overviewError) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-head__eyebrow">Overview</div>
            <h1 className="page-head__title">Dashboard</h1>
          </div>
        </div>
        <Alert tone="error" title="Could not load your dashboard">
          {overviewError.message}
          <div className="mt-3">
            <Button variant="outline" size="sm" icon="refresh" onClick={reloadOverview}>
              Try again
            </Button>
          </div>
        </Alert>
      </>
    );
  }

  if (!overview) return <LoadingDashboard />;

  const { totals, storage, breakdown, timeline, topDownloaded, latest, activity } = overview;
  const tone = usageTone(storage.usedPercent);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">{greeting}</div>
          <h1 className="page-head__title gradient-text">{user?.firstName}&rsquo;s workspace</h1>
          <p className="page-head__sub">
            {totals.documents === 0
              ? "Nothing stored yet — upload your first document to get started."
              : `${formatNumber(totals.documents)} document${totals.documents === 1 ? "" : "s"} · ${storage.usedLabel} stored · ${formatNumber(totals.downloads)} download${totals.downloads === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="page-head__actions">
          <Button variant="ghost" icon="refresh" onClick={reloadOverview} loading={loadingOverview}>
            Refresh
          </Button>
          <Button variant="primary" icon="upload" onClick={openUpload}>
            Upload
          </Button>
        </div>
      </div>

      <div className="grid-metrics">
        <MetricTile
          label="Documents"
          icon="files"
          value={compactNumber(totals.documents)}
          meta={`${formatNumber(totals.starred)} starred`}
          spark={timeline}
          sparkColor="#67e8f9"
          accent="linear-gradient(135deg,#67e8f9,#5b8cff)"
        />
        <MetricTile
          label="Downloads"
          icon="download"
          value={compactNumber(totals.downloads)}
          meta={`${formatNumber(totals.views)} views`}
          accent="linear-gradient(135deg,#a855f7,#5b8cff)"
        />
        <MetricTile
          label="Active shares"
          icon="share"
          value={compactNumber(totals.peopleShares + totals.activeLinks)}
          meta={`${formatNumber(totals.peopleShares)} people · ${formatNumber(totals.activeLinks)} links`}
          accent="linear-gradient(135deg,#34d399,#67e8f9)"
        />
        <MetricTile
          label="Shared with me"
          icon="users"
          value={compactNumber(totals.sharedWithMe)}
          meta={totals.trashed ? `${formatNumber(totals.trashed)} in trash` : "Trash is empty"}
          accent="linear-gradient(135deg,#fbbf24,#fb7185)"
        />
      </div>

      <div className="grid-split">
        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Upload activity</div>
              <div className="panel__subtitle">Files added over the last two weeks</div>
            </div>
          </div>
          <div className="panel__body">
            <DayBars data={timeline} />
          </div>
        </section>

        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Storage</div>
              <div className="panel__subtitle">
                {storage.usedLabel} of {storage.quotaLabel}
              </div>
            </div>
            {tone !== "ok" ? (
              <Badge tone={tone === "danger" ? "danger" : "warning"}>
                {tone === "danger" ? "Almost full" : "Filling up"}
              </Badge>
            ) : null}
          </div>
          <div className="panel__body col gap-5 center" style={{ alignItems: "center" }}>
            <StorageRing
              percent={storage.usedPercent}
              usedLabel={storage.usedLabel}
              quotaLabel={storage.quotaLabel}
              tone={tone}
            />
            <div className="w-100">
              <CategoryBreakdown items={breakdown.categories} />
            </div>
            {storage.averageBytes ? (
              <p className="text-xs dim">Average document size {storage.averageLabel}</p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="grid-split">
        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Recently added</div>
              <div className="panel__subtitle">Your newest uploads</div>
            </div>
            <Link to="/documents" className="text-sm link-quiet row gap-1">
              View all <Icon name="arrowRight" size={13} />
            </Link>
          </div>

          {latest.length ? (
            <div>
              {latest.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="doc-row"
                  onClick={() => openDocument(item.id)}
                  style={{ gridTemplateColumns: "42px minmax(0,1fr) auto auto" }}
                >
                  <FileGlyph category={item.category} size="sm" />
                  <span className="doc-row__name">
                    <span className="doc-row__title">{item.title}</span>
                    <span className="doc-row__meta">
                      {item.sizeLabel} · {relativeTime(item.createdAt)}
                    </span>
                  </span>
                  <Badge tone={item.visibility}>{visibilityLabel(item.visibility)}</Badge>
                  <span className="text-xs dim nums row gap-1">
                    <Icon name="download" size={12} />
                    {formatNumber(item.downloadCount)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon="upload"
              title="No documents yet"
              action={
                <Button variant="primary" icon="upload" onClick={openUpload}>
                  Upload your first file
                </Button>
              }
            >
              Drop a file anywhere on this page, or press <span className="kbd">U</span> to open the uploader.
            </Empty>
          )}
        </section>

        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Your recent activity</div>
              <div className="panel__subtitle">Audited actions</div>
            </div>
            <Link to="/activity" className="text-sm link-quiet row gap-1">
              Full log <Icon name="arrowRight" size={13} />
            </Link>
          </div>
          <div className="panel__body">
            {activity.length ? (
              <div className="timeline">
                {activity.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="timeline__item">
                    <span className="timeline__dot">
                      <Icon name={iconForAction(entry.action)} size={13} />
                    </span>
                    <div className="timeline__text">
                      <div className="truncate">
                        <span className="muted">{entry.label}</span>{" "}
                        {entry.documentTitle ? <span className="semi">{entry.documentTitle}</span> : null}
                      </div>
                      <div className="timeline__time">{relativeTime(entry.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm dim">Nothing recorded yet.</p>
            )}
          </div>
        </section>
      </div>

      {topDownloaded.length ? (
        <section className="panel panel--flush">
          <div className="panel__header">
            <div>
              <div className="panel__title">Most downloaded</div>
              <div className="panel__subtitle">What people keep coming back for</div>
            </div>
          </div>
          <div>
            {topDownloaded.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="doc-row"
                onClick={() => openDocument(item.id)}
                style={{ gridTemplateColumns: "42px minmax(0,1fr) auto" }}
              >
                <span className="glyph glyph--sm">
                  <span className="mono bold" style={{ zIndex: 1 }}>
                    {index + 1}
                  </span>
                </span>
                <span className="doc-row__name">
                  <span className="doc-row__title">{item.title}</span>
                  <span className="doc-row__meta">{item.sizeLabel}</span>
                </span>
                <span className="text-sm nums row gap-2">
                  <Icon name="download" size={13} className="dim" />
                  {formatNumber(item.downloadCount)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
