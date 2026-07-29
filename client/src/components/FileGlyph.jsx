import { Icon, CATEGORY_ICON } from "../lib/icons";

/**
 * The tile shown next to every document. Colour and glyph both come from the
 * server-assigned category, so the icon can never contradict the file type.
 */
export default function FileGlyph({ category = "other", extension, size = "" }) {
  return (
    <span className={`glyph glyph--${category} ${size ? `glyph--${size}` : ""}`}>
      {extension ? (
        <span
          className="mono"
          style={{
            fontSize: size === "lg" ? 12 : size === "sm" ? 8 : 10,
            fontWeight: 700,
            letterSpacing: "0.02em",
            zIndex: 1,
            textTransform: "uppercase",
          }}
        >
          {extension.slice(0, 4)}
        </span>
      ) : (
        <Icon name={CATEGORY_ICON[category] || "file"} size={size === "lg" ? 24 : 17} />
      )}
    </span>
  );
}
