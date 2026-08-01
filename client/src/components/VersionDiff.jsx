import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Select, Spinner } from "./ui";
import { api } from "../lib/api";
import { Icon } from "../lib/icons";
import { diffLines, toHunks } from "../lib/diff";

/**
 * What changed between two versions of a document.
 *
 * Keeping every version is only half of versioning: "v3, 4 KB, two days ago"
 * does not tell you whether a sentence changed or the file was replaced. Both
 * sides are fetched through the existing `/preview/text?version=` endpoint, so
 * this needed no new API surface — and it inherits that endpoint's permission
 * check rather than inventing a second one.
 *
 * Text only, and honest about it: a diff of two PDFs would have to compare the
 * container bytes, which is worse than saying nothing.
 */
export default function VersionDiff({ documentId, versions = [], isText, onClose }) {
  const latest = versions[0]?.version ?? 1;
  const previous = versions[1]?.version ?? latest;

  const [base, setBase] = useState(previous);
  const [target, setTarget] = useState(latest);
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!isText || base === target) {
      setState({ status: "idle" });
      return undefined;
    }

    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        // Both at once: they are independent reads and the wait is the slow part.
        const [from, to] = await Promise.all([
          api.documents.textPreview(documentId, { version: base }),
          api.documents.textPreview(documentId, { version: target }),
        ]);
        if (cancelled) return;
        setState({
          status: "ready",
          from: from.content,
          to: to.content,
          clipped: from.truncated || to.truncated,
        });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: error.message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, base, target, isText]);

  const result = useMemo(
    () => (state.status === "ready" ? diffLines(state.from, state.to) : null),
    [state]
  );
  const hunks = useMemo(() => (result ? toHunks(result.rows, 3) : []), [result]);

  if (!isText) {
    return (
      <Alert tone="info" title="These versions cannot be compared line by line">
        A line diff only means something for text. Download the versions you want to compare, or open
        each one in the Preview tab.
      </Alert>
    );
  }

  if (versions.length < 2) {
    return (
      <Alert tone="info" title="Nothing to compare yet">
        Upload a second version and the changes between them will show up here.
      </Alert>
    );
  }

  return (
    <div className="col gap-4">
      <div className="row gap-2 wrap items-center">
        <Select
          value={base}
          onChange={(event) => setBase(Number(event.target.value))}
          aria-label="Compare from version"
          style={{ width: "auto" }}
        >
          {versions.map((entry) => (
            <option key={entry.version} value={entry.version}>
              v{entry.version}
            </option>
          ))}
        </Select>

        {/* Drawn, not typed. A literal "→" renders as an empty box wherever the
            font lacks the glyph, which is the second time that has bitten this
            interface. */}
        <Icon name="arrowRight" size={14} className="dim" aria-hidden="true" />

        <Select
          value={target}
          onChange={(event) => setTarget(Number(event.target.value))}
          aria-label="Compare to version"
          style={{ width: "auto" }}
        >
          {versions.map((entry) => (
            <option key={entry.version} value={entry.version}>
              v{entry.version}
            </option>
          ))}
        </Select>

        {result ? (
          <span className="row gap-2 text-xs nums">
            <span className="diff-stat diff-stat--add">+{result.added}</span>
            <span className="diff-stat diff-stat--remove">-{result.removed}</span>
          </span>
        ) : null}

        {onClose ? (
          <Button variant="ghost" size="sm" icon="close" onClick={onClose} className="ml-auto">
            Close
          </Button>
        ) : null}
      </div>

      {base === target ? (
        <p className="text-sm dim">Pick two different versions.</p>
      ) : null}

      {state.status === "loading" ? (
        <div className="row gap-2 items-center text-sm dim">
          <Spinner /> Reading both versions…
        </div>
      ) : null}

      {state.status === "error" ? (
        <Alert tone="error" title="Could not read those versions">
          {state.message}
        </Alert>
      ) : null}

      {result && result.truncated ? (
        <Alert tone="warning" title="Too large to align precisely">
          These versions differ by more lines than can be matched up, so the whole changed span is
          shown as replaced rather than paired line by line.
        </Alert>
      ) : null}

      {state.clipped ? (
        <p className="text-xs dim">
          Only the beginning of each version is compared — the preview endpoint returns the first part
          of a file.
        </p>
      ) : null}

      {result && result.added === 0 && result.removed === 0 ? (
        <p className="text-sm dim">These two versions are identical, line for line.</p>
      ) : null}

      {hunks.map((hunk, index) => (
        <div key={index} className="diff">
          {hunk.skippedBefore > 0 ? (
            <div className="diff__skip">
              {hunk.skippedBefore} unchanged line{hunk.skippedBefore === 1 ? "" : "s"}
            </div>
          ) : null}
          {hunk.rows.map((line, lineIndex) => (
            <div key={lineIndex} className={`diff__line diff__line--${line.type}`}>
              <span className="diff__num">{line.before ?? ""}</span>
              <span className="diff__num">{line.after ?? ""}</span>
              <span className="diff__sign">
                {/* ASCII, both because every font has it and because it is what a
                    diff has looked like since diff(1). */}
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              {/* Rendered as text, never as markup: this is file content. */}
              <code className="diff__text">{line.text === "" ? "\u00a0" : line.text}</code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
