import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Button, Empty, IconButton, Spinner, Textarea } from "./ui";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { relativeTime } from "../lib/format";

/**
 * Render a comment body with `@mentions` highlighted.
 *
 * Built by splitting the string, never by injecting HTML — the body is user
 * input, so interpolating it into markup would be an XSS hole for the sake of a
 * coloured span.
 */
function CommentBody({ text }) {
  const parts = String(text).split(/(@[A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g);

  return (
    <div className="comment__body">
      {parts.map((part, index) =>
        part.startsWith("@") ? (
          <span key={index} className="mention">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </div>
  );
}

function Comment({ comment, onReply, onEdit, onDelete, canModerate, depth = 0 }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await onEdit(comment, draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="comment">
      <Avatar name={comment.author.name} color={comment.author.accentColor} size="sm" />

      <div style={{ minWidth: 0 }}>
        <div className="comment__meta">
          <strong className="semi" style={{ color: "var(--text)" }}>
            {comment.author.name}
          </strong>
          <span>{relativeTime(comment.createdAt)}</span>
          {comment.edited ? <span title="This comment was edited">· edited</span> : null}

          {!comment.deleted && (comment.isMine || canModerate) ? (
            <span className="comment__actions ml-auto">
              {comment.isMine ? (
                <IconButton
                  icon="edit"
                  label="Edit comment"
                  size={12}
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(true);
                  }}
                />
              ) : null}
              <IconButton
                icon="trash"
                label={comment.isMine ? "Delete comment" : "Remove this comment"}
                size={12}
                onClick={() => onDelete(comment)}
              />
            </span>
          ) : null}
        </div>

        {comment.deleted ? (
          <div className="comment__body comment__body--deleted">This comment was removed.</div>
        ) : editing ? (
          <div className="col gap-2 mt-1">
            <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={4000} />
            <div className="row gap-2">
              <Button variant="primary" size="sm" icon="check" onClick={save} loading={busy} disabled={!draft.trim()}>
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <CommentBody text={comment.body} />
        )}

        {/* Replies are one level deep only, so there is no reply button on one. */}
        {depth === 0 && !comment.deleted ? (
          <button type="button" className="link-quiet text-xs mt-1" onClick={() => onReply(comment)}>
            Reply
          </button>
        ) : null}

        {comment.replies?.length ? (
          <div className="comment__replies">
            {comment.replies.map((reply) => (
              <Comment
                key={reply.id}
                comment={reply}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                canModerate={canModerate}
                depth={depth + 1}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Discussion thread for a document.
 *
 * Refetches when `commentRevision` changes, which the SSE stream bumps — so a
 * colleague's comment appears without a reload, and without this component
 * needing to know anything about transports.
 */
export default function CommentsPanel({ documentId, canModerate }) {
  const { user } = useAuth();
  const { commentRevision } = useWorkspace();
  const toast = useToast();

  const [state, setState] = useState({ status: "loading", comments: [] });
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [posting, setPosting] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.comments.list(documentId);
      setState({ status: "ready", comments: payload.comments });
    } catch (error) {
      setState({ status: "error", comments: [], error });
    }
  }, [documentId]);

  useEffect(() => {
    load();
  }, [load, commentRevision]);

  async function post() {
    const body = draft.trim();
    if (!body) return;

    setPosting(true);
    try {
      const result = await api.comments.create(documentId, {
        body,
        ...(replyTo ? { parentId: replyTo.id } : {}),
      });

      setDraft("");
      setReplyTo(null);
      await load();

      // Tell the author when a handle matched nobody, rather than letting them
      // believe someone was notified.
      if (result.unresolvedMentions?.length) {
        toast.warning(
          "Some mentions did not match anyone",
          `No account for: ${result.unresolvedMentions.map((handle) => `@${handle}`).join(", ")}`
        );
      }
    } catch (error) {
      toast.fromError(error, "Could not post your comment");
    } finally {
      setPosting(false);
    }
  }

  async function edit(comment, body) {
    try {
      await api.comments.update(documentId, comment.id, body.trim());
      await load();
    } catch (error) {
      toast.fromError(error, "Could not save your edit");
    }
  }

  async function remove(comment) {
    try {
      await api.comments.remove(documentId, comment.id);
      await load();
    } catch (error) {
      toast.fromError(error, "Could not delete that comment");
    }
  }

  function startReply(comment) {
    setReplyTo(comment);
    // Pre-fill the mention so a reply notifies the person being replied to.
    const handle = comment.author.name.split(" ")[0].toLowerCase();
    setDraft((current) => (current.includes(`@${handle}`) ? current : `@${handle} ${current}`.trim()));
    inputRef.current?.focus();
  }

  if (state.status === "loading") {
    return (
      <div className="row center" style={{ padding: "var(--space-6)" }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className="col gap-4">
      <div className="col gap-2">
        {replyTo ? (
          <div className="row between text-xs">
            <span className="muted">
              Replying to <strong className="semi">{replyTo.author.name}</strong>
            </span>
            <button type="button" className="link-quiet" onClick={() => setReplyTo(null)}>
              Cancel
            </button>
          </div>
        ) : null}

        <Textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Cmd/Ctrl+Enter submits; plain Enter keeps making paragraphs.
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              post();
            }
          }}
          placeholder="Add a comment… use @name to notify someone"
          rows={3}
          maxLength={4000}
        />

        <div className="row between">
          <span className="text-xs dim">
            <span className="kbd">⌘</span>/<span className="kbd">Ctrl</span> +{" "}
            <span className="kbd">↵</span> to post
          </span>
          <Button
            variant="primary"
            size="sm"
            icon="activity"
            onClick={post}
            loading={posting}
            disabled={!draft.trim()}
          >
            {replyTo ? "Reply" : "Comment"}
          </Button>
        </div>
      </div>

      <hr className="divider" />

      {state.comments.length ? (
        <div>
          {state.comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              onReply={startReply}
              onEdit={edit}
              onDelete={remove}
              canModerate={canModerate}
            />
          ))}
        </div>
      ) : (
        <Empty icon="activity" title="No comments yet">
          Start the discussion — mention a colleague with <span className="mono">@name</span> and they will be
          notified.
        </Empty>
      )}
    </div>
  );
}
