import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Chip,
  ConfirmDialog,
  DescriptionList,
  Field,
  IconButton,
  Input,
  Progress,
  Select,
  Skeleton,
  Tabs,
  Textarea,
} from "./ui";
import FileGlyph from "./FileGlyph";
import DocumentPreview from "./DocumentPreview";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import {
  categoryLabel,
  formatBytes,
  formatDate,
  formatNumber,
  relativeTime,
  visibilityHint,
  visibilityLabel,
} from "../lib/format";

const MAX_TAGS = 12;

/**
 * Right-hand detail panel.
 *
 * Every affordance is driven by `document.permissions` from the server, so the
 * UI cannot offer an action the API would reject.
 */
export default function DocumentDrawer({ documentId, onClose, onChanged, onShare }) {
  const toast = useToast();
  const versionInputRef = useRef(null);

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'trash' | 'delete' | null
  const [busyAction, setBusyAction] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(undefined);

  const [form, setForm] = useState({ title: "", description: "", visibility: "private", tags: [] });
  const [tagDraft, setTagDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.documents.get(documentId);
      setDetail(payload);
      setForm({
        title: payload.document.title,
        description: payload.document.description,
        visibility: payload.document.visibility,
        tags: payload.document.tags || [],
      });
      setSelectedVersion(undefined);
    } catch (error) {
      toast.fromError(error, "Could not open this document");
      onClose?.();
    } finally {
      setLoading(false);
    }
  }, [documentId, toast, onClose]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes the drawer, matching the modal behaviour.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !confirm) onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, confirm]);

  const doc = detail?.document;

  async function save() {
    setSaving(true);
    try {
      const payload = { title: form.title, description: form.description, tags: form.tags };
      if (doc.permissions.canManage) payload.visibility = form.visibility;

      await api.documents.update(doc.id, payload);
      toast.success("Changes saved");
      setEditing(false);
      await load();
      onChanged?.();
    } catch (error) {
      toast.fromError(error, "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    try {
      await api.documents.download(doc.id, {
        version: selectedVersion,
        filename: doc.file.originalName,
      });
      onChanged?.();
    } catch (error) {
      toast.fromError(error, "Download failed");
    }
  }

  async function toggleStar() {
    try {
      if (doc.isStarred) await api.documents.unstar(doc.id);
      else await api.documents.star(doc.id);
      await load();
      onChanged?.();
    } catch (error) {
      toast.fromError(error, "Could not update the star");
    }
  }

  async function uploadVersion(file) {
    const form2 = new FormData();
    form2.append("file", file);

    setUploadProgress(0);
    try {
      await api.documents.addVersion(doc.id, form2, setUploadProgress);
      toast.success("New version uploaded");
      await load();
      onChanged?.();
    } catch (error) {
      toast.fromError(error, "Could not upload the new version");
    } finally {
      setUploadProgress(null);
    }
  }

  async function runDestructive() {
    setBusyAction(true);
    try {
      if (confirm === "trash") {
        await api.documents.trash(doc.id);
        toast.success("Moved to trash", "You can restore it from the Trash view.");
      } else if (confirm === "restore") {
        await api.documents.restore(doc.id);
        toast.success("Document restored");
      } else {
        await api.documents.destroy(doc.id);
        toast.success("Deleted permanently");
      }

      setConfirm(null);
      onChanged?.();
      if (confirm === "restore") await load();
      else onClose?.();
    } catch (error) {
      toast.fromError(error, "Action failed");
    } finally {
      setBusyAction(false);
    }
  }

  const commitTag = () => {
    const candidate = tagDraft.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 24);
    if (!candidate) return;
    setForm((current) =>
      current.tags.includes(candidate) || current.tags.length >= MAX_TAGS
        ? current
        : { ...current, tags: [...current.tags, candidate] }
    );
    setTagDraft("");
  };

  if (loading || !doc) {
    return (
      <aside className="drawer" role="dialog" aria-label="Document details" aria-busy="true">
        <div className="drawer__header col gap-3">
          <Skeleton height={20} width="60%" />
          <Skeleton height={13} width="40%" />
        </div>
        <div className="drawer__body">
          <Skeleton height={90} />
          <Skeleton height={140} />
          <Skeleton height={70} />
        </div>
      </aside>
    );
  }

  const activeVersion =
    selectedVersion === undefined
      ? null
      : detail.versions.find((entry) => entry.version === selectedVersion);

  return (
    <>
      <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />

      <aside className="drawer" role="dialog" aria-label={`Details for ${doc.title}`}>
        <header className="drawer__header">
          <div className="row-start between gap-3">
            <div className="row-start gap-3 grow" style={{ minWidth: 0 }}>
              <FileGlyph category={doc.file.category} extension={doc.file.extension} size="lg" />
              <div style={{ minWidth: 0 }}>
                <h2 className="text-md bold break-word">{doc.title}</h2>
                <div className="text-xs dim mt-1">
                  {doc.file.originalName} · {doc.file.sizeLabel} · v{doc.version}
                </div>
                <div className="row wrap gap-2 mt-2">
                  <Badge tone={doc.visibility}>{visibilityLabel(doc.visibility)}</Badge>
                  {doc.status === "trashed" ? <Badge tone="danger">In trash</Badge> : null}
                  {!doc.isOwner ? <Badge tone="violet">{doc.accessLevel} access</Badge> : null}
                </div>
              </div>
            </div>

            <div className="row gap-1 none">
              <IconButton
                icon="star"
                label={doc.isStarred ? "Remove star" : "Add star"}
                active={doc.isStarred}
                onClick={toggleStar}
              />
              <IconButton icon="close" label="Close details" onClick={onClose} />
            </div>
          </div>
        </header>

        <div className="drawer__body">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "preview", label: "Preview" },
              { value: "versions", label: "Versions", count: detail.versions.length },
              { value: "activity", label: "Activity" },
            ]}
          />

          {tab === "overview" ? (
            editing ? (
              <div className="col gap-4">
                <Field label="Title">
                  <Input
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    maxLength={180}
                  />
                </Field>

                <Field label="Description">
                  <Textarea
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    rows={4}
                    maxLength={2000}
                  />
                </Field>

                <Field label="Tags" hint={`${form.tags.length}/${MAX_TAGS}`}>
                  <Input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        commitTag();
                      }
                    }}
                    onBlur={commitTag}
                    placeholder="Press Enter to add"
                  />
                  {form.tags.length ? (
                    <div className="row wrap gap-2 mt-1">
                      {form.tags.map((tag) => (
                        <Chip
                          key={tag}
                          active
                          onRemove={() =>
                            setForm((current) => ({
                              ...current,
                              tags: current.tags.filter((item) => item !== tag),
                            }))
                          }
                        >
                          {tag}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                </Field>

                {doc.permissions.canManage ? (
                  <Field label="Visibility" hint={visibilityHint(form.visibility)}>
                    <Select
                      value={form.visibility}
                      onChange={(event) => setForm({ ...form, visibility: event.target.value })}
                    >
                      <option value="private">Private</option>
                      <option value="internal">Team</option>
                      <option value="public">Public</option>
                    </Select>
                  </Field>
                ) : (
                  <Alert tone="info">Only the owner can change who can see this document.</Alert>
                )}

                <div className="row gap-3">
                  <Button variant="primary" icon="check" onClick={save} loading={saving}>
                    Save changes
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setForm({
                        title: doc.title,
                        description: doc.description,
                        visibility: doc.visibility,
                        tags: doc.tags || [],
                      });
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="col gap-4">
                {doc.description ? (
                  <p className="text-sm muted pre-wrap break-word">{doc.description}</p>
                ) : (
                  <p className="text-sm dim">No description.</p>
                )}

                {doc.tags?.length ? (
                  <div className="row wrap gap-2">
                    {doc.tags.map((tag) => (
                      <Chip key={tag}>{tag}</Chip>
                    ))}
                  </div>
                ) : null}

                <DescriptionList
                  items={[
                    { key: "Owner", value: doc.isOwner ? "You" : doc.ownerName },
                    { key: "Type", value: `${categoryLabel(doc.file.category)} · ${doc.file.mimeType}` },
                    { key: "Size", value: doc.file.sizeLabel },
                    { key: "Uploaded", value: formatDate(doc.createdAt, { withTime: true }) },
                    { key: "Updated", value: `${formatDate(doc.updatedAt, { withTime: true })} (${relativeTime(doc.updatedAt)})` },
                    { key: "Downloads", value: formatNumber(doc.downloadCount) },
                    { key: "Views", value: formatNumber(doc.viewCount) },
                    {
                      key: "Checksum",
                      value: doc.file.checksum ? (
                        <span className="mono text-xs break-word">{doc.file.checksum.slice(0, 24)}…</span>
                      ) : null,
                    },
                  ]}
                />

                {doc.permissions.canEdit ? (
                  <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>
                    Edit details
                  </Button>
                ) : null}
              </div>
            )
          ) : null}

          {tab === "preview" ? (
            <DocumentPreview document={doc} version={selectedVersion} />
          ) : null}

          {tab === "versions" ? (
            <div className="col gap-4">
              {doc.permissions.canEdit ? (
                <>
                  <input
                    ref={versionInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) uploadVersion(file);
                    }}
                  />
                  {uploadProgress === null ? (
                    <Button variant="outline" icon="upload" onClick={() => versionInputRef.current?.click()}>
                      Upload a new version
                    </Button>
                  ) : (
                    <div className="col gap-2">
                      <span className="text-xs dim">Uploading… {uploadProgress}%</span>
                      <Progress value={uploadProgress} />
                    </div>
                  )}
                </>
              ) : null}

              {activeVersion ? (
                <Alert tone="warning" title={`Viewing version ${activeVersion.version}`}>
                  <button type="button" className="link-quiet" onClick={() => setSelectedVersion(undefined)}>
                    Switch back to the latest version
                  </button>
                </Alert>
              ) : null}

              <div className="timeline">
                {detail.versions.map((entry) => (
                  <div key={entry.version} className="timeline__item">
                    <span className="timeline__dot">
                      <span className="text-xs mono">{entry.version}</span>
                    </span>
                    <div className="timeline__text">
                      <div className="row between gap-2 wrap">
                        <span className="semi break-word">{entry.originalName}</span>
                        <span className="row gap-1 none">
                          {entry.version === doc.version ? <Badge tone="accent">Current</Badge> : null}
                          <IconButton
                            icon="eye"
                            label={`Preview version ${entry.version}`}
                            size={13}
                            onClick={() => {
                              setSelectedVersion(entry.version);
                              setTab("preview");
                            }}
                          />
                          <IconButton
                            icon="download"
                            label={`Download version ${entry.version}`}
                            size={13}
                            onClick={() =>
                              api.documents
                                .download(doc.id, { version: entry.version, filename: entry.originalName })
                                .catch((error) => toast.fromError(error, "Download failed"))
                            }
                          />
                        </span>
                      </div>
                      <div className="timeline__time">
                        {formatBytes(entry.size)} · {relativeTime(entry.uploadedAt)}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "activity" ? (
            detail.activity.length ? (
              <div className="timeline">
                {detail.activity.map((entry) => (
                  <div key={entry.id} className="timeline__item">
                    <span className="timeline__dot">
                      <Icon name={iconForAction(entry.action)} size={13} />
                    </span>
                    <div className="timeline__text">
                      <div>
                        <span className="semi">{entry.actorName}</span>{" "}
                        <span className="muted">{entry.label.toLowerCase()}</span>
                      </div>
                      {entry.detail ? <div className="text-xs dim break-word">{entry.detail}</div> : null}
                      <div className="timeline__time">{relativeTime(entry.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm dim">No activity recorded yet.</p>
            )
          ) : null}

          {detail.shares.length && doc.permissions.canManage ? (
            <div className="panel panel--tight col gap-2">
              <div className="row between">
                <span className="text-xs upper dim bold">Shared with</span>
                <button type="button" className="link-quiet text-xs" onClick={() => onShare?.(doc)}>
                  Manage
                </button>
              </div>
              {detail.shares.slice(0, 4).map((share) => (
                <div key={share.id} className="row between gap-2 text-sm">
                  <span className="truncate muted">
                    {share.type === "link" ? "Public link" : share.email}
                  </span>
                  <Badge>{share.permission}</Badge>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <footer className="drawer__footer">
          <Button variant="primary" icon="download" onClick={download} className="grow">
            Download
          </Button>

          {doc.permissions.canManage ? (
            <Button variant="outline" icon="share" onClick={() => onShare?.(doc)}>
              Share
            </Button>
          ) : null}

          {doc.status === "trashed" ? (
            <>
              <IconButton icon="restore" label="Restore" onClick={() => setConfirm("restore")} />
              <IconButton icon="trash" label="Delete permanently" onClick={() => setConfirm("delete")} />
            </>
          ) : doc.permissions.canDelete ? (
            <IconButton icon="trash" label="Move to trash" onClick={() => setConfirm("trash")} />
          ) : null}
        </footer>
      </aside>

      <ConfirmDialog
        open={confirm === "trash"}
        onClose={() => setConfirm(null)}
        onConfirm={runDestructive}
        busy={busyAction}
        title="Move to trash?"
        message={`"${doc.title}" will be hidden from your library. You can restore it later from the Trash view.`}
        confirmLabel="Move to trash"
      />

      <ConfirmDialog
        open={confirm === "restore"}
        onClose={() => setConfirm(null)}
        onConfirm={runDestructive}
        busy={busyAction}
        tone="primary"
        title="Restore this document?"
        message={`"${doc.title}" will reappear in your library.`}
        confirmLabel="Restore"
      />

      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={runDestructive}
        busy={busyAction}
        title="Delete permanently?"
        message={`Every stored version of "${doc.title}" will be erased from disk, and all share links will stop working. This cannot be undone.`}
        confirmLabel="Delete forever"
        confirmWord="DELETE"
      />
    </>
  );
}

/** Map an audit action onto an icon. */
export function iconForAction(action = "") {
  if (action.startsWith("share")) return "share";
  if (action.includes("download")) return "download";
  if (action.includes("upload") || action.includes("version")) return "upload";
  if (action.includes("delete")) return "trash";
  if (action.includes("trash")) return "trash";
  if (action.includes("restore")) return "restore";
  if (action.includes("star")) return "star";
  if (action.includes("view")) return "eye";
  if (action.includes("login") || action.includes("registered")) return "users";
  if (action.includes("password")) return "lock";
  return "edit";
}
