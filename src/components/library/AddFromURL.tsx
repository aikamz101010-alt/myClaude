import { useState } from 'react'
import { cn } from '@/lib/utils'
import { X, Link, Download, AlertTriangle, Check, ExternalLink } from 'lucide-react'

interface Props {
  onClose: () => void
}

type Step = 'input' | 'preview' | 'installing' | 'done' | 'error'

interface Preview {
  name: string
  contentSnippet: string
  hasWarning: boolean
  fileCount: number
}

function mockFetchPreview(url: string): Promise<Preview> {
  // Real implementation would invoke Tauri command — for now mock it
  return new Promise((resolve) => {
    setTimeout(() => {
      const name = url.split('/').pop()?.replace('.md', '') ?? 'unknown-skill'
      resolve({
        name,
        contentSnippet: `# ${name}\n\nA custom skill loaded from:\n${url}\n\nThis skill will be installed to your Claude CLI plugins directory.`,
        hasWarning: url.startsWith('http'),
        fileCount: 1,
      })
    }, 800)
  })
}

const URL_EXAMPLES = [
  'github.com/user/skill-repo',
  'raw.githubusercontent.com/user/repo/main/skill.md',
  'npm:my-claude-skill',
  '/local/path/to/skill',
]

export function AddFromURL({ onClose }: Props) {
  const [url, setUrl] = useState('')
  const [step, setStep] = useState<Step>('input')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [target, setTarget] = useState<'global' | 'project'>('global')
  const [errorMsg, setErrorMsg] = useState('')

  const handleFetch = async () => {
    if (!url.trim()) return
    setStep('preview')
    try {
      const result = await mockFetchPreview(url.trim())
      setPreview(result)
    } catch (e) {
      setErrorMsg(String(e))
      setStep('error')
    }
  }

  const handleInstall = async () => {
    setStep('installing')
    // Simulate install (real: invoke Tauri command)
    await new Promise((r) => setTimeout(r, 1200))
    setStep('done')
    setTimeout(onClose, 1800)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="glass rounded-2xl w-[460px] p-5 shadow-2xl border border-white/10 animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <Link className="w-3.5 h-3.5 text-accent" />
            </div>
            <h2 className="text-sm font-mono font-bold text-text">Add Skill from URL</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-text cursor-pointer transition-colors rounded-lg hover:bg-surface2/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step: Input */}
        {step === 'input' && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted font-mono mb-2">Supported formats:</p>
              <div className="space-y-1">
                {URL_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setUrl(ex)}
                    className="flex items-center gap-2 w-full text-left px-2 py-1 rounded-lg hover:bg-surface2/50 transition-colors cursor-pointer group"
                  >
                    <ExternalLink className="w-3 h-3 text-muted group-hover:text-accent transition-colors flex-shrink-0" />
                    <span className="text-xs font-mono text-muted group-hover:text-text transition-colors truncate">
                      {ex}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-mono text-muted block mb-1.5">URL or path</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                placeholder="github.com/user/skill-repo"
                className={cn(
                  'w-full bg-surface2 rounded-xl px-3 py-2.5',
                  'text-sm font-mono text-text placeholder-muted',
                  'focus:outline-none focus:ring-1 focus:ring-accent/50',
                )}
                autoFocus
              />
            </div>

            <button
              onClick={handleFetch}
              disabled={!url.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed glow-accent"
            >
              Fetch &amp; Preview
            </button>
          </div>
        )}

        {/* Step: Preview */}
        {step === 'preview' && preview && (
          <div className="space-y-4">
            {preview.hasWarning && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-warning/10 border border-warning/20">
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-mono text-warning font-semibold">Review before installing</p>
                  <p className="text-xs text-warning/70 font-mono">Content from the internet — verify it's trustworthy.</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-muted">Name</span>
                <span className="text-xs font-mono font-semibold text-text">{preview.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-muted">Files</span>
                <span className="text-xs font-mono text-text">{preview.fileCount}</span>
              </div>
            </div>

            <div>
              <p className="text-xs font-mono text-muted mb-1.5">Content preview</p>
              <pre className="bg-surface2 rounded-xl p-3 text-xs font-mono text-muted max-h-32 overflow-y-auto whitespace-pre-wrap">
                {preview.contentSnippet}
              </pre>
            </div>

            <div>
              <p className="text-xs font-mono text-muted mb-1.5">Install to</p>
              <div className="flex gap-2">
                {(['global', 'project'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTarget(t)}
                    className={cn(
                      'flex-1 py-2 rounded-xl text-xs font-mono cursor-pointer transition-all border',
                      target === t
                        ? 'bg-accent/10 text-accent border-accent/30'
                        : 'bg-surface2/50 text-muted border-white/5 hover:text-text',
                    )}
                  >
                    {t === 'global' ? '🌍 Global (~/.claude/)' : '📁 This Project'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep('input')}
                className="flex-1 py-2 rounded-xl text-sm font-mono bg-surface2 text-muted hover:text-text cursor-pointer transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleInstall}
                className="flex-1 py-2 rounded-xl text-sm font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors flex items-center justify-center gap-2 glow-accent"
              >
                <Download className="w-4 h-4" /> Install
              </button>
            </div>
          </div>
        )}

        {/* Step: Preview loading (fetching) */}
        {step === 'preview' && !preview && (
          <div className="flex flex-col items-center py-10 gap-4">
            <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-mono text-muted">Fetching preview...</p>
          </div>
        )}

        {/* Step: Installing */}
        {step === 'installing' && (
          <div className="flex flex-col items-center py-10 gap-4">
            <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-mono text-muted">Installing {preview?.name}...</p>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="flex flex-col items-center py-10 gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center glow-accent">
              <Check className="w-6 h-6 text-accent" />
            </div>
            <div className="text-center">
              <p className="text-sm font-mono font-bold text-accent">Installed!</p>
              <p className="text-xs text-muted font-mono mt-1">
                {preview?.name} is now in your Library.
              </p>
            </div>
          </div>
        )}

        {/* Step: Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-error/10 border border-error/20">
              <AlertTriangle className="w-4 h-4 text-error flex-shrink-0" />
              <p className="text-xs font-mono text-error">{errorMsg || 'Failed to fetch URL'}</p>
            </div>
            <button
              onClick={() => setStep('input')}
              className="w-full py-2 rounded-xl text-sm font-mono bg-surface2 text-muted hover:text-text cursor-pointer transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
