import { Modal } from "./ui";
import { modifierKeyLabel } from "../lib/format";

/**
 * The keyboard model, written down.
 *
 * The interface is keyboard-first and said so nowhere, which meant nobody found
 * it: a first-time user reaches for the mouse and never learns that `Space`
 * opens a preview. `?` is the convention for this, and the footer hint on the
 * library points at it.
 *
 * Kept as data rather than markup so the same list can be read by the command
 * palette without the two drifting apart.
 */
export const SHORTCUTS = [
  {
    group: "Anywhere",
    items: [
      { keys: ["mod", "K"], label: "Command palette" },
      { keys: ["/"], label: "Focus search" },
      { keys: ["U"], label: "Upload a file" },
      { keys: ["mod", "V"], label: "Upload whatever is on the clipboard" },
      { keys: ["?"], label: "This list" },
      { keys: ["Esc"], label: "Close the topmost thing" },
    ],
  },
  {
    group: "Moving through the library",
    items: [
      // Spelled out rather than drawn: arrow glyphs are missing from a good
      // number of installed fonts and land as empty boxes, and a shortcut list
      // that renders as tofu is worse than one that uses words.
      { keys: ["Arrow keys"], label: "Move the cursor between documents" },
      { keys: ["Space"], label: "Quick Look at the cursored document" },
      { keys: ["Left", "Right"], label: "Move between documents inside Quick Look" },
      { keys: ["Enter"], label: "Open the full document" },
    ],
  },
  {
    group: "Selecting",
    items: [
      { keys: ["X"], label: "Add the cursored document to the selection" },
      { keys: ["mod", "A"], label: "Select everything on this page" },
      { keys: ["mod", "click"], label: "Add a document to the selection" },
      { keys: ["Esc"], label: "Clear the selection" },
    ],
  },
  {
    group: "Writing",
    items: [
      { keys: ["mod", "Enter"], label: "Post a comment" },
      { keys: ["@"], label: "Mention someone, and notify them" },
    ],
  },
];

function Keys({ keys }) {
  const mod = modifierKeyLabel();
  return (
    <span className="row gap-1 items-center">
      {keys.map((key, index) => {
        const label = key === "mod" ? mod : key;
        // Arrows and other symbols are missing from many monospace faces and
        // render as tofu. Those keys borrow the interface font, which has them.
        const glyph = !/^[\x20-\x7E]+$/.test(label);
        return (
          <kbd key={`${key}-${index}`} className={`kbd ${glyph ? "kbd--glyph" : ""}`}>
            {label}
          </kbd>
        );
      })}
    </span>
  );
}

export default function ShortcutSheet({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      subtitle="Everything here works without the mouse. Shortcuts are ignored while you are typing in a field."
      width="640px"
    >
      <div className="shortcut-grid">
        {SHORTCUTS.map((section) => (
          <section key={section.group} className="col gap-2">
            <h3 className="nav__section" style={{ padding: 0 }}>
              {section.group}
            </h3>
            <dl className="shortcut-list">
              {section.items.map((item) => (
                <div key={item.label} className="shortcut-row">
                  <dt className="text-sm">{item.label}</dt>
                  <dd>
                    <Keys keys={item.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
