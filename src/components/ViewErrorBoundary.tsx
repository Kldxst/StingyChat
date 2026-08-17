import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error?: Error }

export class ViewErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('Workspace view failed to load', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="view-load-error" role="alert">
        <span><TriangleAlert size={22} /></span>
        <h2>工作区暂时无法加载</h2>
        <p>资源可能在网络切换或版本更新期间中断。当前本地数据未受影响。</p>
        <button onClick={() => location.reload()}><RefreshCw size={15} /> 重新加载视图</button>
      </section>
    );
  }
}
