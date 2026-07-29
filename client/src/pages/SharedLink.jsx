import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, DescriptionList, Field, Input, Spinner } from "../components/ui";
import FileGlyph from "../components/FileGlyph";
import DocumentPreview from "../components/DocumentPreview";
import Backdrop from "../components/Backdrop";
import { BrandMark, Icon } from "../lib/icons";
import { api } from "../lib/api";
import { Link, useParams } from "../lib/router";
import { useToast } from "../context/ToastContext";
import { categoryLabel, formatDate, formatNumber, relativeTime } from "../lib/format";

/** Terminal states get their own copy — "this link is dead" is not the same as "wrong password". */
const FAILURE_COPY = {
  LINK_NOT_FOUND: {
    icon: "search",
    title: "This link does not exist",
    text: "It may have been mistyped, or the document owner may have deleted it.",
  },
  LINK_REVOKED: {
    icon: "lock",
    title: "This link was revoked",
    text: "The owner has turned off access. Ask them for a fresh link.",
  },
  LINK_EXPIRED: {
    icon: "clock",
    title: "This link has expired",
    text: "It was created with an expiry date that has now passed.",
  },
  LINK_EXHAUSTED: {
    icon: "download",
    title: "Download limit reached",
    text: "This link had a maximum number of downloads and has hit it.",
  },
  DOCUMENT_GONE: {
    icon: "trash",
    title: "The document is no longer available",
    text: "It was deleted or moved to the trash by its owner.",
  },
};

/**
 * Public landing page for `/s/:token`.
 *
 * Deliberately independent of the authenticated shell: a recipient may have no
 * account at all, so there is no sidebar, no session and no protected data.
 */
export default function SharedLink() {
  const { token } = useParams();
  const toast = useToast();

  const [state, setState] = useState({ status: "loading" });
  const [password, setPassword] = useState("");
  const [submittedPassword, setSubmittedPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(
    async (candidate = "") => {
      try {
        const payload = await api.publicShare.view(token, candidate);
        setSubmittedPassword(candidate);
        setState({ status: "ready", ...payload });
        return true;
      } catch (error) {
        if (error.code === "LINK_PASSWORD_REQUIRED") {
          setState({ status: "locked" });
        } else if (error.code === "LINK_PASSWORD_INVALID") {
          setState({ status: "locked", error: "That password is not correct" });
        } else {
          setState({ status: "failed", code: error.code, message: error.message });
        }
        return false;
      }
    },
    [token]
  );

  useEffect(() => {
    document.title = "Shared document · DSMS";
    load();
  }, [load]);

  async function unlock(event) {
    event.preventDefault();
    setUnlocking(true);
    await load(password);
    setUnlocking(false);
  }

  async function download() {
    setDownloading(true);
    try {
      await api.publicShare.download(token, submittedPassword, state.document.file.originalName);
      // Re-read so the remaining-download counter stays honest.
      await load(submittedPassword);
    } catch (error) {
      toast.fromError(error, "Download failed");
      await load(submittedPassword);
    } finally {
      setDownloading(false);
    }
  }

  const frame = (children) => (
    <>
      <Backdrop />
      <div className="share-page">
        <div className="share-card col gap-4">
          <div className="row between">
            <Link to="/" className="row gap-3" style={{ color: "inherit" }}>
              <span className="brand__mark">
                <BrandMark size={20} />
              </span>
              <span>
                <span className="brand__name gradient-text">DSMS</span>
                <span className="brand__tag" style={{ display: "block" }}>
                  Shared document
                </span>
              </span>
            </Link>
            <Link to="/login" className="text-sm link-quiet row gap-1">
              Sign in <Icon name="arrowRight" size={13} />
            </Link>
          </div>
          {children}
        </div>
      </div>
    </>
  );

  if (state.status === "loading") {
    return frame(
      <div className="panel panel--pad row center" style={{ minHeight: 200 }}>
        <Spinner large />
      </div>
    );
  }

  if (state.status === "failed") {
    const copy = FAILURE_COPY[state.code] || {
      icon: "alert",
      title: "This link cannot be opened",
      text: state.message,
    };

    return frame(
      <div className="panel panel--pad col gap-4 center" style={{ alignItems: "center", textAlign: "center" }}>
        <span className="empty__icon">
          <Icon name={copy.icon} size={26} />
        </span>
        <div>
          <h1 className="text-lg bold">{copy.title}</h1>
          <p className="text-sm dim mt-2">{copy.text}</p>
        </div>
        <Link to="/login">
          <Button variant="outline" iconRight="arrowRight">
            Go to DSMS
          </Button>
        </Link>
      </div>
    );
  }

  if (state.status === "locked") {
    return frame(
      <form className="panel panel--pad col gap-4" onSubmit={unlock}>
        <div className="row gap-4">
          <span className="glyph glyph--lg">
            <Icon name="lock" size={24} />
          </span>
          <div>
            <h1 className="text-lg bold">This document is password protected</h1>
            <p className="text-sm dim mt-1">
              Enter the password the sender gave you to view and download it.
            </p>
          </div>
        </div>

        {state.error ? <Alert tone="error" title={state.error} /> : null}

        <Field label="Password" htmlFor="share-password">
          <Input
            id="share-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            icon="lock"
            autoComplete="off"
            required
            autoFocus
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={unlocking} disabled={!password} block>
          Unlock document
        </Button>
      </form>
    );
  }

  const { document: doc, share } = state;

  return frame(
    <div className="panel panel--flush">
      <div className="share-card__hero">
        <FileGlyph category={doc.file.category} extension={doc.file.extension} size="lg" />
        <div className="grow" style={{ minWidth: 0 }}>
          <h1 className="text-lg bold break-word">{doc.title}</h1>
          <div className="text-sm dim mt-1">
            Shared by {doc.ownerName || "a DSMS user"} · {doc.file.sizeLabel} · v{doc.version}
          </div>
          <div className="row wrap gap-2 mt-2">
            <Badge tone="accent" icon="link">
              {share.permission === "edit" ? "Can edit" : "View only"}
            </Badge>
            {share.expiresAt ? (
              <Badge tone="warning" icon="clock">
                Expires {formatDate(share.expiresAt)}
              </Badge>
            ) : null}
            {share.remainingDownloads !== null ? (
              <Badge tone={share.remainingDownloads <= 1 ? "danger" : undefined} icon="download">
                {formatNumber(share.remainingDownloads)} download
                {share.remainingDownloads === 1 ? "" : "s"} left
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel__body col gap-5">
        {doc.description ? <p className="text-sm muted pre-wrap break-word">{doc.description}</p> : null}

        {doc.tags?.length ? (
          <div className="row wrap gap-2">
            {doc.tags.map((tag) => (
              <span key={tag} className="chip">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {/* DocumentPreview owns the "can this be shown inline?" decision and
            renders its own explanatory state, so there is no second copy of
            that rule here to drift out of sync. */}
        <DocumentPreview document={doc} publicToken={token} publicPassword={submittedPassword} />

        <DescriptionList
          items={[
            { key: "File name", value: doc.file.originalName },
            { key: "Type", value: `${categoryLabel(doc.file.category)} · ${doc.file.mimeType}` },
            { key: "Size", value: doc.file.sizeLabel },
            { key: "Last updated", value: `${formatDate(doc.updatedAt)} (${relativeTime(doc.updatedAt)})` },
            { key: "Downloads via this link", value: formatNumber(share.downloadCount) },
          ]}
        />

        <Button variant="primary" size="lg" icon="download" onClick={download} loading={downloading} block>
          Download {doc.file.originalName}
        </Button>

        <p className="text-xs dim center-text">
          Opening this link is recorded in the document&rsquo;s audit trail.
        </p>
      </div>
    </div>
  );
}
