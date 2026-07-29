import { useCallback, useEffect, useState } from "react";
import { Alert, Avatar, Badge, Button, ConfirmDialog, Field, IconButton, Input, Modal, Progress, Select, Skeleton } from "./ui";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatDate, formatNumber, usageTone } from "../lib/format";

/**
 * Account administration.
 *
 * Every guard here is duplicated server-side — this only hides controls that
 * would be refused anyway, so the UI never implies a permission it does not have.
 */
export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();

  const [state, setState] = useState({ status: "loading", users: [], meta: null });
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDeactivate, setPendingDeactivate] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: current.meta ? "refreshing" : "loading" }));
    try {
      const payload = await api.admin.users({ search: debounced, page, limit: 20 });
      setState({ status: "ready", ...payload });
    } catch (error) {
      setState({ status: "error", error, users: [], meta: null });
    }
  }, [debounced, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function apply(userId, patch, successMessage) {
    setSaving(true);
    try {
      await api.admin.updateUser(userId, patch);
      toast.success(successMessage);
      setEditing(null);
      setPendingDeactivate(null);
      await load();
    } catch (error) {
      toast.fromError(error, "Could not update this account");
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "error") {
    return (
      <Alert tone="error" title="Could not load accounts">
        {state.error.message}
      </Alert>
    );
  }

  return (
    <section className="panel panel--flush">
      <div className="panel__header">
        <div>
          <div className="panel__title">Accounts</div>
          <div className="panel__subtitle">
            {state.meta ? `${formatNumber(state.meta.total)} total` : "Roles, access and quotas"}
          </div>
        </div>
        <div className="row gap-2">
          <Input
            icon="search"
            type="search"
            placeholder="Search accounts…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search accounts"
          />
          <IconButton icon="refresh" label="Reload accounts" onClick={load} />
        </div>
      </div>

      {state.status === "loading" ? (
        <div className="panel__body col gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="row gap-3">
              <Skeleton height={34} width={34} radius={9} />
              <div className="grow col gap-2">
                <Skeleton height={13} width="40%" />
                <Skeleton height={10} width="25%" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div
            className="doc-row doc-row__head"
            style={{ gridTemplateColumns: "34px minmax(0,1.8fr) 88px minmax(0,1fr) 96px auto" }}
          >
            <span />
            <span>Account</span>
            <span>Role</span>
            <span className="doc-row__hide-sm">Storage</span>
            <span className="doc-row__hide-sm">Joined</span>
            <span />
          </div>

          {state.users.map((account) => {
            const isSelf = account.id === me?.id;
            const inactive = account.isActive === false;

            return (
              <div
                key={account.id}
                className="doc-row"
                style={{ gridTemplateColumns: "34px minmax(0,1.8fr) 88px minmax(0,1fr) 96px auto", cursor: "default" }}
              >
                <Avatar name={account.fullName} color={account.accentColor} size="sm" />

                <div className="doc-row__name">
                  <span className="doc-row__title">
                    {account.fullName}
                    {isSelf ? <span className="dim"> (you)</span> : null}
                  </span>
                  <span className="doc-row__meta">{account.email}</span>
                </div>

                <span className="row gap-1">
                  <Badge tone={account.role === "admin" ? "violet" : undefined}>{account.role}</Badge>
                  {inactive ? <Badge tone="danger">off</Badge> : null}
                </span>

                <div className="doc-row__hide-sm col gap-1">
                  <span className="text-xs dim nums">
                    {account.usedLabel} / {account.quotaLabel}
                  </span>
                  <Progress value={account.usedPercent} tone={usageTone(account.usedPercent)} />
                  <span className="text-xs dim">
                    {formatNumber(account.documents)} docs
                    {account.trashed ? ` · ${formatNumber(account.trashed)} trashed` : ""}
                  </span>
                </div>

                <span className="doc-row__meta doc-row__hide-sm">{formatDate(account.createdAt)}</span>

                <div className="row gap-1">
                  <IconButton
                    icon="settings"
                    label={`Edit ${account.email}`}
                    onClick={() => setEditing({ ...account, storageQuotaGb: account.quotaBytes / 1024 ** 3 })}
                  />
                  {inactive ? (
                    <IconButton
                      icon="restore"
                      label={`Reactivate ${account.email}`}
                      onClick={() => apply(account.id, { isActive: true }, `${account.email} reactivated`)}
                    />
                  ) : (
                    // Self-deactivation is refused server-side; don't offer it.
                    !isSelf && (
                      <IconButton
                        icon="lock"
                        label={`Deactivate ${account.email}`}
                        onClick={() => setPendingDeactivate(account)}
                      />
                    )
                  )}
                </div>
              </div>
            );
          })}

          {!state.users.length ? (
            <div className="panel__body">
              <p className="text-sm dim row gap-2">
                <Icon name="search" size={14} /> No accounts match “{debounced}”.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {state.meta && state.meta.pages > 1 ? (
        <div className="panel__body pager">
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

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.fullName}` : ""}
        subtitle={editing?.email}
        width="narrow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="check"
              loading={saving}
              onClick={() =>
                apply(
                  editing.id,
                  { role: editing.role, storageQuotaGb: Number(editing.storageQuotaGb) },
                  `${editing.email} updated`
                )
              }
            >
              Save
            </Button>
          </>
        }
      >
        {editing ? (
          <>
            <Field
              label="Role"
              hint={
                editing.id === me?.id
                  ? "You may step down only while another active admin remains"
                  : undefined
              }
            >
              <Select
                value={editing.role}
                onChange={(event) => setEditing({ ...editing, role: event.target.value })}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>

            <Field label="Storage quota (GB)" hint="0 removes the limit">
              <Input
                type="number"
                min="0"
                max="10000"
                step="0.5"
                value={editing.storageQuotaGb}
                onChange={(event) => setEditing({ ...editing, storageQuotaGb: event.target.value })}
              />
            </Field>

            <Alert tone="info">
              Currently using {editing.usedLabel} across {formatNumber(editing.documents)} document(s).
            </Alert>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDeactivate)}
        onClose={() => setPendingDeactivate(null)}
        onConfirm={() =>
          apply(pendingDeactivate.id, { isActive: false }, `${pendingDeactivate.email} deactivated`)
        }
        busy={saving}
        title="Deactivate this account?"
        message={
          pendingDeactivate
            ? `${pendingDeactivate.email} will be signed out of every device immediately and will not be able to sign in. Their documents are untouched and you can reactivate them at any time.`
            : ""
        }
        confirmLabel="Deactivate"
      />
    </section>
  );
}
