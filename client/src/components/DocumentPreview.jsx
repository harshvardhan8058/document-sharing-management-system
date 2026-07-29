import { useEffect, useState } from "react";
import { Alert, Button, Spinner } from "./ui";
import { api } from "../lib/api";

/**
 * Inline preview.
 *
 * Protected endpoints cannot be pointed at with a bare `src` (no way to attach
 * the bearer token), so binaries are fetched as blobs and rendered from an
 * object URL — which is revoked on unmount to avoid leaking memory as the user
 * browses between documents.
 */
export default function DocumentPreview({ document: doc, version, publicToken, publicPassword }) {
  const [state, setState] = useState({ status: "loading" });

  const mimeType = doc.file.mimeType;
  const isImage = /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(mimeType);
  const isPdf = mimeType === "application/pdf";
  const isText = /^text\/|application\/(json|xml)/.test(mimeType);

  useEffect(() => {
    let cancelled = false;
    let createdUrl = null;

    async function load() {
      setState({ status: "loading" });

      if (!doc.file.previewable && !isText) {
        setState({ status: "unsupported" });
        return;
      }

      try {
        // Text is rendered as text on both paths. Anonymous visitors have no
        // /preview/text endpoint, so their copy is read from the raw response.
        if (isText) {
          const payload = publicToken
            ? await api.publicShare.previewText(publicToken, publicPassword)
            : await api.documents.textPreview(doc.id, { version });

          if (cancelled) return;
          setState({ status: "text", content: payload.content, truncated: payload.truncated });
          return;
        }

        const url = publicToken
          ? await api.publicShare.previewUrl(publicToken, publicPassword)
          : await api.documents.previewUrl(doc.id, { version });

        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setState({ status: "blob", url });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: error.message });
      }
    }

    load();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [doc.id, doc.file.previewable, isText, version, publicToken, publicPassword]);

  if (state.status === "loading") {
    return (
      <div className="preview">
        <Spinner large />
      </div>
    );
  }

  if (state.status === "unsupported") {
    return (
      <Alert tone="info" title="No inline preview for this file type">
        Download the file to open it in its native application.
      </Alert>
    );
  }

  if (state.status === "error") {
    return (
      <Alert tone="error" title="Preview unavailable">
        {state.message}
      </Alert>
    );
  }

  if (state.status === "text") {
    return (
      <div className="col gap-2">
        <div className="preview">
          <pre>{state.content}</pre>
        </div>
        {state.truncated ? (
          <p className="text-xs dim">Preview truncated — download the file to read all of it.</p>
        ) : null}
      </div>
    );
  }

  if (isImage) {
    return (
      <div className="preview">
        <img src={state.url} alt={doc.file.originalName} />
      </div>
    );
  }

  if (isPdf) {
    return (
      <div className="col gap-2">
        <div className="preview">
          <iframe src={state.url} title={`Preview of ${doc.title}`} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon="external"
          onClick={() => window.open(state.url, "_blank", "noopener,noreferrer")}
        >
          Open in a new tab
        </Button>
      </div>
    );
  }

  return (
    <Alert tone="info" title="No inline preview for this file type">
      Download the file to open it.
    </Alert>
  );
}
