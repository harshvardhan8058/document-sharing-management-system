import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Button, Empty, IconButton, Spinner, Textarea } from "./ui";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { modifierKeyLabel, relativeTime } from "../lib/format";
import { activeMention, applyMention } from "../lib/mentions";

/** Nothing suggested, nothing open. */
const CLOSED = { open: false, query: "", items: [], index: 0 };

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

  // -- @mention autocomplete -------------------------------------------------

  const [mentions, setMentions] = useState(CLOSED);
  const mentionToken = useRef(null);
  const lookupTimer = useRef(null);

  /**
   * Decide whether the caret is inside a mention, and if so look up people.
   *
   * The token is kept in a ref rather than in state: by the time a suggestion is
   * clicked, several renders have happened, and replacing the wrong span of text
   * is worse than not offering the feature.
   */
  const openMentionsFor = useCallback((text, caret) => {
    const token = activeMention(text, caret);
    mentionToken.current = token;

    clearTimeout(lookupTimer.current);
    if (!token) {
      setMentions(CLOSED);
      return;
    }

    setMentions((current) => ({ ...current, open: true, query: token.query }));

    // Debounced: one request per pause, not one per keystroke.
    lookupTimer.current = setTimeout(async () => {
      try {
        const { users } = await api.auth.directory(token.query);
        // Ignore a response that arrived after the caret left the mention.
        if (!mentionToken.current) return;
        setMentions({ open: true, query: token.query, items: users.slice(0, 6), index: 0 });
      } catch {
        // A failed lookup should leave the comment box alone, not error at
        // someone who is only typing.
        setMentions(CLOSED);
      }
    }, 160);
  }, []);

  useEffect(() => () => clearTimeout(lookupTimer.current), []);

  const choose = useCallback((person) => {
    const token = mentionToken.current;
    if (!person || !token) return;

    setDraft((current) => {
      const { text, caret } = applyMention(current, token, person.email);
      // Put the caret back where the typing was, after React has painted.
      requestAnimationFrame(() => {
        const field = inputRef.current;
        if (field) {
          field.focus();
          field.setSelectionRange(caret, caret);
        }
      });
      return text;
    });

    mentionToken.current = null;
    setMentions(CLOSED);
  }, []);

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

        <div className="mention-wrap">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              // Read the caret from the event, not from a later render.
              openMentionsFor(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={(event) => {
              // The suggestion list owns the arrow keys and Enter while it is up,
              // or picking a name would post the comment instead.
              if (mentions.open && mentions.items.length) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMentions((current) => ({
                    ...current,
                    index: (current.index + 1) % current.items.length,
                  }));
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setMentions((current) => ({
                    ...current,
                    index: (current.index - 1 + current.items.length) % current.items.length,
                  }));
                  return;
                }
                if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault();
                  choose(mentions.items[mentions.index]);
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  choose(mentions.items[mentions.index]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentions(CLOSED);
                  return;
                }
              }

              // Cmd/Ctrl+Enter submits; plain Enter keeps making paragraphs.
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                post();
              }
            }}
            onBlur={() => {
              // Deferred: a click on a suggestion blurs the field first.
              setTimeout(() => setMentions(CLOSED), 120);
            }}
            placeholder="Add a comment… type @ to notify someone"
            rows={3}
            maxLength={4000}
            aria-autocomplete="list"
            aria-expanded={mentions.open}
          />

          {mentions.open && mentions.items.length ? (
            <ul className="mention-list" role="listbox" aria-label="People to mention">
              {mentions.items.map((person, index) => (
                <li key={person.id ?? person.email}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === mentions.index}
                    className={`mention-list__item ${index === mentions.index ? "is-active" : ""}`}
                    // Mouse-down, because a click would arrive after the blur
                    // that closes this list.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(person);
                    }}
                    onMouseEnter={() => setMentions((current) => ({ ...current, index }))}
                  >
                    <Avatar name={person.fullName} email={person.email} size="sm" />
                    <span className="col" style={{ gap: 0, minWidth: 0 }}>
                      <span className="semi truncate">{person.fullName || person.email}</span>
                      <span className="text-xs dim truncate">{person.email}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="row between">
          {/* The real modifier for this platform, and "Enter" spelled out: this
              said "⌘/Ctrl + ↵" on every machine, which is wrong on Windows and
              renders as empty boxes wherever the font lacks those glyphs. */}
          <span className="text-xs dim">
            <span className="kbd">{modifierKeyLabel()}</span> + <span className="kbd">Enter</span> to post
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
