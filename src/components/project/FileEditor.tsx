import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { Save, Check, Eye, Code, RefreshCw, FileText } from 'lucide-react'

interface Props {
  path: string
}

function isMarkdown(path: string) {
  return /\.(md|mdx|markdown)$/i.test(path)
}

function basename(p: string) {
  return p.split('/').pop() ?? p
}

// ── Markdown viewer ───────────────────────────────────────────────
function MdView({ content }: { content: string }) {
  return (
    <div className="prose-chat max-w-none text-sm text-text leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }) {
            const inline = !className
            const lang = className?.replace('language-', '') ?? ''
            if (inline) return <code className="px-1 py-0.5 rounded text-xs font-mono bg-surface2/80 text-accent">{children}</code>
            return (
              <div className="my-2 rounded-lg overflow-hidden border border-white/10">
                {lang && <div className="px-3 py-1 bg-surface2/60 text-xs font-mono text-muted border-b border-white/5">{lang}</div>}
                <pre className="p-3 overflow-x-auto bg-surface/60"><code className="text-xs font-mono text-text">{children}</code></pre>
              </div>
            )
          },
          h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3 text-text">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 text-text">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2 text-text">{children}</h3>,
          p:  ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
          a:  ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:text-accent/80">{children}</a>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/40 pl-3 text-muted italic my-2">{children}</blockquote>,
          strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
          em: ({ children }) => <em className="italic text-muted">{children}</em>,
          hr: () => <hr className="border-white/10 my-3" />,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs font-mono border-collapse w-full">{children}</table></div>,
          th: ({ children }) => <th className="border border-white/10 px-2 py-1 bg-surface2/60 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-white/10 px-2 py-1">{children}</td>,
        }}
      >{content}</ReactMarkdown>
    </div>
  )
}

export function FileEditor({ path }: Props) {
  const md = isMarkdown(path)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit'>(md ? 'view' : 'edit')

  const load = () => {
    setLoading(true); setError('')
    invoke<string>('read_file', { path })
      .then(c => { setContent(c); setOriginal(c) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    setMode(md ? 'view' : 'edit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const dirty = content !== original

  const handleSave = async () => {
    try {
      await invoke('write_file', { path, content })
      setOriginal(content)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { setError(String(e)) }
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-muted flex-shrink-0" />
          <span className="text-xs font-mono text-text truncate">{basename(path)}</span>
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" title="Unsaved changes" />}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {md && (
            <div className="flex items-center gap-0.5 bg-surface2/60 rounded-lg p-0.5 mr-1">
              <button onClick={() => setMode('view')}
                className={cn('flex items-center gap-1 px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors',
                  mode === 'view' ? 'bg-surface text-text' : 'text-muted hover:text-text')}>
                <Eye className="w-3 h-3" /> View
              </button>
              <button onClick={() => setMode('edit')}
                className={cn('flex items-center gap-1 px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors',
                  mode === 'edit' ? 'bg-surface text-text' : 'text-muted hover:text-text')}>
                <Code className="w-3 h-3" /> Edit
              </button>
            </div>
          )}
          <button onClick={load} className="p-1.5 text-muted hover:text-text cursor-pointer rounded-lg hover:bg-surface2/50" title="Reload">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleSave} disabled={!dirty}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold cursor-pointer transition-all',
              saved ? 'bg-accent text-bg' : dirty ? 'bg-surface2 text-text hover:bg-surface border border-white/10' : 'bg-surface2/40 text-muted cursor-not-allowed')}>
            {saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted font-mono text-xs">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-error font-mono text-xs px-4 text-center">{error}</div>
        ) : md && mode === 'view' ? (
          <div className="p-5"><MdView content={content} /></div>
        ) : (
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            spellCheck={false}
            className="w-full h-full min-h-full bg-transparent p-4 text-xs font-mono text-text resize-none focus:outline-none leading-relaxed"
            style={{ tabSize: 2 }}
          />
        )}
      </div>
    </div>
  )
}
