import { useEffect, useState } from "react";

/**
 * Window-level drag-and-drop detection.
 *
 * Uses a counter rather than a boolean because dragenter/dragleave fire for
 * every nested element the cursor crosses — a boolean flickers, a counter does
 * not. Only reacts when the drag actually carries files.
 */
export function useDocumentDrop(onFiles) {
  const [isDragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;

    const carriesFiles = (event) =>
      Array.from(event.dataTransfer?.types || []).includes("Files");

    const onDragEnter = (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };

    const onDragOver = (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
    };

    const onDragLeave = (event) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const onDrop = (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);

      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) onFiles(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  return isDragging;
}
