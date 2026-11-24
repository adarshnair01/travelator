import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TravelEditorPage from './travel/TravelEditorPage.jsx'

// Show what went wrong instead of a blank page.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold">Travelator couldn&apos;t start</h1>
          <p className="text-text-muted">Please reload the page. If it keeps happening, the message below says what went wrong.</p>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-night-card p-3 text-left text-xs text-frost">{String(error?.message || error)}</pre>
          <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-holly px-5 py-2 font-bold text-snow hover:bg-holly-deep">Reload</button>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <TravelEditorPage />
    </ErrorBoundary>
  </StrictMode>,
)
