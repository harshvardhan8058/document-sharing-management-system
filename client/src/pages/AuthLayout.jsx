import { BrandMark, Icon } from "../lib/icons";

const FEATURES = [
  {
    icon: "shield",
    title: "Permissions that actually hold",
    text: "Owner, manage, edit and view resolved server-side on every request — never inferred from the UI.",
  },
  {
    icon: "link",
    title: "Links you can take back",
    text: "Public links carry an optional password, an expiry date and a hard download cap.",
  },
  {
    icon: "history",
    title: "Every version kept",
    text: "Uploading a revision never overwrites history — download any earlier version at any time.",
  },
  {
    icon: "activity",
    title: "A complete audit trail",
    text: "Uploads, downloads, edits, shares and revocations are all recorded with who, when and from where.",
  },
];

/** Split-screen frame shared by the sign-in and sign-up screens. */
export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <aside className="auth__aside">
        <div className="row gap-3">
          <span className="brand__mark">
            <BrandMark size={22} />
          </span>
          <div>
            <div className="brand__name gradient-text">DSMS</div>
            <div className="brand__tag">Document sharing &amp; management</div>
          </div>
        </div>

        <div>
          <h1 className="auth__headline gradient-text">Your documents, under control.</h1>
          <p className="auth__lede">
            Upload, version, share and audit every file in one place — with access rules enforced by the
            server, not by hope.
          </p>
        </div>

        <div className="auth__features">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="auth__feature">
              <span className="auth__feature-icon">
                <Icon name={feature.icon} size={17} />
              </span>
              <div>
                <div className="auth__feature-title">{feature.title}</div>
                <p className="auth__feature-text mt-1">{feature.text}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs dim">
          Runs on MongoDB in production, or on a zero-config embedded store for local development.
        </p>
      </aside>

      <section className="auth__panel">{children}</section>
    </div>
  );
}
