import { Component } from "react";
import { Icon } from "../lib/icons";

/**
 * Last line of defence: a render error anywhere below this point shows a
 * recoverable screen instead of a blank page.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console -- surfacing this is the whole point
    console.error("Unhandled UI error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="share-page">
        <div className="panel panel--pad col gap-4" style={{ maxWidth: "34rem", textAlign: "center", alignItems: "center" }}>
          <span className="empty__icon">
            <Icon name="alert" size={26} />
          </span>
          <div>
            <h1 className="text-lg bold">Something went wrong in the interface</h1>
            <p className="text-sm dim mt-2">
              The error has been logged to the browser console. Reloading usually clears it.
            </p>
          </div>
          <pre
            className="mono text-xs"
            style={{
              textAlign: "left",
              maxWidth: "100%",
              overflow: "auto",
              padding: "12px",
              borderRadius: "9px",
              background: "rgba(4,6,16,0.5)",
              border: "1px solid var(--line)",
              color: "var(--text-muted)",
            }}
          >
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
