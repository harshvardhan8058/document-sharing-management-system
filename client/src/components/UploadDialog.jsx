import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Chip, Field, IconButton, Input, Modal, Progress, Select, Textarea } from "./ui";
import FileGlyph from "./FileGlyph";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { formatBytes, visibilityHint } from "../lib/format";
import { categoryOf, extensionOf } from "../lib/fileTypes";

const MAX_TAGS = 12;

/**
 * Upload dialog.
 *
 * Accepts several files at once and creates one document per file, uploading
 * them sequentially so a large batch cannot saturate the connection or trip the
 * rate limiter. Each file carries its own progress and its own error, so one
 * rejected file does not discard the rest of the batch.
 */
export default function UploadDialog({ open, onClose, onUploaded, limits, initialFiles = [] }) {
  const toast = useToast();
  const fileInputRef = useRef(null);

  const [queue, setQueue] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const maxBytes = limits?.maxUploadBytes ?? 25 * 1024 * 1024;
  const allowed = useMemo(() => limits?.allowedExtensions ?? [], [limits]);

  const reset = useCallback(() => {
    setQueue([]);
    setTitle("");
    setDescription("");
    setTags([]);
    setTagDraft("");
    setVisibility("private");
    setBusy(false);
  }, []);

  /**
   * Hash a file in the browser and ask whether it has been uploaded before.
   *
   * SubtleCrypto needs a secure context, so this is skipped over plain HTTP
   * (localhost counts as secure). A failure here is silent — duplicate detection
   * is an aid, and it must never block an upload.
   */
  const checkForDuplicate = useCallback(async (item) => {
    if (!window.crypto?.subtle) return;
    // Hashing a very large file in one go would block; the warning is not worth it.
    if (item.file.size > 64 * 1024 * 1024) return;

    try {
      const digest = await window.crypto.subtle.digest("SHA-256", await item.file.arrayBuffer());
      const checksum = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      const result = await api.documents.duplicateCheck(checksum);
      if (!result.duplicate) return;

      setQueue((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, duplicateOf: result.document } : entry))
      );
    } catch {
      /* best effort */
    }
  }, []);

  /** Validate locally so obvious problems surface before a round trip. */
  const describeProblem = useCallback(
    (file) => {
      const ext = extensionOf(file.name);
      if (!ext) return "No file extension";
      if (allowed.length && !allowed.includes(ext)) return `.${ext} files are not allowed`;
      if (file.size > maxBytes) return `Larger than the ${formatBytes(maxBytes)} limit`;
      if (file.size === 0) return "File is empty";
      return null;
    },
    [allowed, maxBytes]
  );

  const addFiles = useCallback(
    (files) => {
      const additions = files.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        progress: 0,
        status: describeProblem(file) ? "invalid" : "pending",
        error: describeProblem(file),
        duplicateOf: null,
      }));

      setQueue((current) => {
        const existing = new Set(current.map((item) => `${item.file.name}:${item.file.size}`));
        return [...current, ...additions.filter((item) => !existing.has(`${item.file.name}:${item.file.size}`))];
      });

      // Hash locally and ask the server whether these bytes are already stored.
      // Doing it before the upload means a duplicate costs one small request
      // instead of the whole file.
      for (const item of additions) {
        if (item.status === "invalid") continue;
        checkForDuplicate(item);
      }
    },
    [describeProblem, checkForDuplicate]
  );

  // Files handed in from a window-level drop open the dialog pre-filled.
  useEffect(() => {
    if (open && initialFiles.length) addFiles(initialFiles);
  }, [open, initialFiles, addFiles]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const removeItem = (id) => setQueue((current) => current.filter((item) => item.id !== id));

  const commitTag = () => {
    const candidate = tagDraft.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 24);
    if (!candidate) return;
    setTags((current) => (current.includes(candidate) || current.length >= MAX_TAGS ? current : [...current, candidate]));
    setTagDraft("");
  };

  const uploadable = queue.filter((item) => item.status === "pending" || item.status === "error");
  const singleFile = queue.length === 1;

  async function handleUpload() {
    if (!uploadable.length) return;
    setBusy(true);

    let succeeded = 0;
    let failed = 0;

    // Sequential on purpose: predictable progress, and gentle on the API.
    for (const item of uploadable) {
      setQueue((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, status: "uploading", progress: 0, error: null } : entry
        )
      );

      const form = new FormData();
      form.append("file", item.file);
      form.append("title", (singleFile && title.trim()) || item.file.name);
      if (description.trim()) form.append("description", description.trim());
      if (tags.length) form.append("tags", tags.join(","));
      form.append("visibility", visibility);

      try {
        await api.documents.create(form, (progress) =>
          setQueue((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, progress } : entry))
          )
        );
        succeeded += 1;
        setQueue((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: "done", progress: 100 } : entry
          )
        );
      } catch (error) {
        failed += 1;
        setQueue((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "error", error: error.message || "Upload failed" }
              : entry
          )
        );
      }
    }

    setBusy(false);

    if (succeeded) {
      toast.success(
        `${succeeded} file${succeeded === 1 ? "" : "s"} uploaded`,
        failed ? `${failed} failed — see the list for details.` : undefined
      );
      onUploaded?.();
    }
    if (!failed) onClose?.();
    else if (!succeeded) toast.error("Nothing was uploaded", "Fix the highlighted problems and try again.");
  }

  const invalidCount = queue.filter((item) => item.status === "invalid").length;

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Upload documents"
      subtitle={`Up to ${formatBytes(maxBytes)} per file`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {queue.some((item) => item.status === "done") ? "Done" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            icon="upload"
            onClick={handleUpload}
            loading={busy}
            disabled={!uploadable.length}
          >
            Upload {uploadable.length ? `${uploadable.length} file${uploadable.length === 1 ? "" : "s"}` : ""}
          </Button>
        </>
      }
    >
      <div
        className={`dropzone ${dragging ? "dropzone--active" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          // The window-level drop listener that opens this dialog also sees the
          // event as it bubbles, so without this the same files are handed in
          // twice. Deduplication hid it; stopping propagation fixes it.
          event.stopPropagation();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files || []));
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <span className="dropzone__icon">
          <Icon name="upload" size={22} />
        </span>
        <div>
          <div className="dropzone__title">Drop files here or click to browse</div>
          <p className="dropzone__hint mt-1">
            {allowed.length ? `Accepted: ${allowed.slice(0, 14).join(", ")}${allowed.length > 14 ? "…" : ""}` : "Any file type"}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            addFiles(Array.from(event.target.files || []));
            event.target.value = ""; // allow re-selecting the same file
          }}
        />
      </div>

      {invalidCount ? (
        <Alert tone="warning" title={`${invalidCount} file${invalidCount === 1 ? "" : "s"} cannot be uploaded`}>
          Remove them or pick different files — the rest of the batch will still upload.
        </Alert>
      ) : null}

      {queue.length ? (
        <div className="col gap-2">
          {queue.map((item) => (
            <div
              key={item.id}
              className={`queue-item ${item.status === "error" || item.status === "invalid" ? "queue-item--error" : ""} ${
                item.status === "done" ? "queue-item--done" : ""
              }`}
            >
              <FileGlyph category={categoryOf(item.file.name)} extension={extensionOf(item.file.name)} size="sm" />

              <div className="grow">
                <div className="row between gap-2">
                  <span className="text-sm semi truncate">{item.file.name}</span>
                  <span className="text-xs dim nums none">{formatBytes(item.file.size)}</span>
                </div>

                {item.status === "uploading" ? (
                  <div className="mt-2">
                    <Progress value={item.progress} />
                  </div>
                ) : null}

                {item.error ? <div className="text-xs danger mt-1">{item.error}</div> : null}

                {/* A warning, not a block: re-uploading the same bytes is
                    sometimes exactly what you meant to do. */}
                {item.duplicateOf ? (
                  <div className="text-xs warning mt-1 row gap-1 wrap">
                    <Icon name="alert" size={11} />
                    Identical to “{item.duplicateOf.title}”
                    {item.duplicateOf.status === "trashed" ? " (in your trash)" : ""} — upload anyway?
                  </div>
                ) : null}
              </div>

              {item.status === "done" ? (
                <Badge tone="accent" icon="check">
                  Done
                </Badge>
              ) : (
                <IconButton
                  icon="close"
                  label={`Remove ${item.file.name}`}
                  size={13}
                  disabled={busy}
                  onClick={() => removeItem(item.id)}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      {singleFile ? (
        <Field label="Title" hint="Defaults to the file name">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={queue[0].file.name}
            maxLength={180}
          />
        </Field>
      ) : null}

      <Field label="Description" hint="Optional">
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What is this document for?"
          maxLength={2000}
          rows={3}
        />
      </Field>

      <Field label="Tags" hint={`${tags.length}/${MAX_TAGS}`}>
        <Input
          value={tagDraft}
          onChange={(event) => setTagDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commitTag();
            } else if (event.key === "Backspace" && !tagDraft && tags.length) {
              setTags((current) => current.slice(0, -1));
            }
          }}
          onBlur={commitTag}
          placeholder="Press Enter to add a tag"
          disabled={tags.length >= MAX_TAGS}
          icon="filter"
        />
        {tags.length ? (
          <div className="row wrap gap-2 mt-1">
            {tags.map((tag) => (
              <Chip key={tag} active onRemove={() => setTags((current) => current.filter((t) => t !== tag))}>
                {tag}
              </Chip>
            ))}
          </div>
        ) : null}
      </Field>

      <Field label="Visibility" hint={visibilityHint(visibility)}>
        <Select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
          <option value="private">Private — only me and people I share with</option>
          <option value="internal">Team — any signed-in member can view</option>
          <option value="public">Public — anyone with the link can view</option>
        </Select>
      </Field>
    </Modal>
  );
}
