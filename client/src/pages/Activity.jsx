import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Empty, Segmented, Skeleton } from "../components/ui";
import { iconForAction } from "../components/DocumentDrawer";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useShell } from "../components/AppShell";
import { formatDate, formatNumber, relativeTime } from "../lib/format";

/** Group entries by calendar day so a long feed stays scannable. */
function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const day = String(entry.createdAt || "").slice(0, 10);
    const last = groups.at(-1);
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

export default function Activity() {
  const { isAdmin } = useAuth();
  const { revision } = useWorkspace();
  const { openDocument } = useShell();

  const [feed, setFeed] = useState("mine");
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: "loading", activities: [], meta: null });

  useEffect(() => {
    document.title = "Activity · DSMS";
  }, []);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const payload =
        feed === "everyone"
          ? await api.stats.activity({ page, limit: 40 })
          : await api.auth.myActivity({ page, limit: 40 });
      setState({ status: "ready", ...payload });
    } catch (error) {
      setState({ status: "error", error, activities: [], meta: null });
    }
  }, [feed, page]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const groups = groupByDay(state.activities);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Audit trail</div>
          <h1 className="page-head__title">Activity</h1>
          <p className="page-head__sub">
            {state.meta
              ? `${formatNumber(state.meta.total)} recorded event${state.meta.total === 1 ? "" : "s"}`
              : "Every mutation is recorded with actor, timestamp and origin."}
          </p>
        </div>

        <div className="page-head__actions">
          {isAdmin ? (
            <Segmented
              ariaLabel="Feed scope"
              value={feed}
              onChange={(value) => {
                setFeed(value);
                setPage(1);
              }}
              options={[
                { value: "mine", label: "Mine", icon: "users" },
                { value: "everyone", label: "Everyone", icon: "shield" },
              ]}
            />
          ) : null}
          <Button variant="ghost" icon="refresh" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {state.status === "error" ? (
        <Alert tone="error" title="Could not load the audit trail">
          {state.error.message}
        </Alert>
      ) : null}

      {state.status === "loading" ? (
        <div className="panel panel--pad col gap-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="row gap-3">
              <Skeleton height={27} width={27} radius={999} />
              <div className="grow col gap-2">
                <Skeleton height={13} width="55%" />
                <Skeleton height={10} width="25%" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {state.status === "ready" ? (
        state.activities.length ? (
          <div className="col gap-4">
            {groups.map((group) => (
              <section key={group.day} className="panel panel--flush">
                <div className="panel__header">
                  <div className="panel__title">{formatDate(group.day)}</div>
                  <div className="panel__subtitle">{group.entries.length} events</div>
                </div>
                <div className="panel__body">
                  <div className="timeline">
                    {group.entries.map((entry) => (
                      <div key={entry.id} className="timeline__item">
                        <span className="timeline__dot">
                          <Icon name={iconForAction(entry.action)} size={13} />
                        </span>
                        <div className="timeline__text">
                          <div className="row between gap-3 wrap">
                            <span className="break-word">
                              <span className="semi">{entry.actorName}</span>{" "}
                              <span className="muted">{entry.label.toLowerCase()}</span>{" "}
                              {entry.documentTitle ? (
                                entry.documentId ? (
                                  <button
                                    type="button"
                                    className="link-quiet semi"
                                    onClick={() => openDocument(entry.documentId)}
                                    style={{ textDecoration: "underline dotted" }}
                                  >
                                    {entry.documentTitle}
                                  </button>
                                ) : (
                                  <span className="semi">{entry.documentTitle}</span>
                                )
                              ) : null}
                            </span>
                            <Badge>{entry.action.split(".")[0]}</Badge>
                          </div>

                          {entry.detail ? (
                            <div className="text-xs dim break-word mt-1">{entry.detail}</div>
                          ) : null}

                          <div className="timeline__time">
                            {relativeTime(entry.createdAt)}
                            {entry.ip ? ` · ${entry.ip}` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ))}

            {state.meta.pages > 1 ? (
              <div className="pager">
                <span className="pager__info">
                  Page {state.meta.page} of {state.meta.pages}
                </span>
                <div className="row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    icon="chevronLeft"
                    disabled={!state.meta.hasPrevious}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    iconRight="chevronRight"
                    disabled={!state.meta.hasNext}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="panel">
            <Empty icon="activity" title="Nothing recorded yet">
              Upload, share or download a document and it will show up here.
            </Empty>
          </div>
        )
      ) : null}
    </>
  );
}
