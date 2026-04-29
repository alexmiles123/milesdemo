import { Component } from "react";

// Top-level error boundary. Without one, a render error in any child
// blanks the entire app — users see a white screen and can't recover.
// We catch, log to /api/log-error (best-effort, never blocking), and
// show a recovery panel that preserves the JWT so reload doesn't kick
// the user back to the login screen.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Best-effort remote log. Endpoint may not exist in every environment;
    // we deliberately swallow failures so the boundary itself can't loop.
    try {
      fetch("/api/log-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: String(error?.message || error),
          stack: String(error?.stack || "").slice(0, 4000),
          component_stack: String(info?.componentStack || "").slice(0, 4000),
          url: typeof window !== "undefined" ? window.location.href : "",
          ts: new Date().toISOString(),
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* noop */ }
    if (typeof console !== "undefined") {
      console.error("Boundary caught:", error, info);
    }
  }

  reset = () => this.setState({ error: null, info: null });

  reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: "100vh", background: "#f7f8fb", color: "#111827",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "Inter, system-ui, sans-serif", padding: 24,
      }}>
        <div style={{ maxWidth: 560, width: "100%", background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 28, boxShadow: "0 8px 24px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 13, fontFamily: "DM Mono,monospace", color: "#dc2626", letterSpacing: "0.12em", marginBottom: 8 }}>SOMETHING WENT WRONG</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>The page hit an unexpected error.</div>
          <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, marginBottom: 18 }}>
            We logged what happened and you can recover by reloading. Your sign-in is preserved.
          </div>
          <pre style={{
            background: "#f5f7fa", border: "1px solid #e5e7eb", borderRadius: 8,
            padding: 12, fontSize: 11, lineHeight: 1.5, color: "#6b7280",
            overflow: "auto", maxHeight: 180, marginBottom: 18,
            fontFamily: "DM Mono,monospace", whiteSpace: "pre-wrap",
          }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={this.reset}
              style={{ background: "transparent", border: "1px solid #e5e7eb", color: "#6b7280", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
              Try Again
            </button>
            <button onClick={this.reload}
              style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
