import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// 全局错误边界：任何子组件抛错时显示可恢复的提示，而不是整页白屏
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[PixelPaint] 渲染错误:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card" style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>🖌️</div>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>画布出了点问题</h2>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, wordBreak: "break-all" }}>
              {this.state.error.message}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                this.setState({ error: null });
                location.reload();
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
