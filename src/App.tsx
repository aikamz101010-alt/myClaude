import { cn } from './lib/utils'

function App() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="glass rounded-2xl p-8 text-center animate-fade-in">
        <h1 className="font-mono text-2xl font-bold text-accent mb-2">Claude Desktop</h1>
        <p className="text-muted text-sm">Design system active</p>
        <div className="mt-4 flex gap-2 justify-center">
          <div className="w-3 h-3 rounded-full bg-accent animate-pulse-glow" />
          <div className="w-3 h-3 rounded-full bg-accent opacity-60" />
          <div className="w-3 h-3 rounded-full bg-accent opacity-30" />
        </div>
      </div>
    </div>
  )
}

export default App
