import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { ChevronRight, ChevronDown, Folder, FolderOpen, File, RefreshCw } from 'lucide-react'

interface DirEntry {
  name: string
  path: string
  is_dir: boolean
}

interface Props {
  rootPath: string
  /** Click a file → e.g. insert @path into chat */
  onFileClick?: (path: string) => void
}

// ── Single node (lazy expand) ─────────────────────────────────────
function Node({ entry, depth, onFileClick }: { entry: DirEntry; depth: number; onFileClick?: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    if (!entry.is_dir) { onFileClick?.(entry.path); return }
    const next = !open
    setOpen(next)
    if (next && children === null) {
      setLoading(true)
      try {
        const list = await invoke<DirEntry[]>('list_directory', { path: entry.path })
        setChildren(list)
      } catch { setChildren([]) }
      setLoading(false)
    }
  }

  return (
    <div>
      <button onClick={toggle}
        className="w-full flex items-center gap-1 px-1 py-0.5 rounded hover:bg-surface2/60 cursor-pointer transition-colors text-left"
        style={{ paddingLeft: depth * 12 + 4 }}
        title={entry.path}>
        {entry.is_dir
          ? (open ? <ChevronDown className="w-3 h-3 text-muted/60 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted/60 flex-shrink-0" />)
          : <span className="w-3 flex-shrink-0" />}
        {entry.is_dir
          ? (open ? <FolderOpen className="w-3.5 h-3.5 text-accent flex-shrink-0" /> : <Folder className="w-3.5 h-3.5 text-accent/80 flex-shrink-0" />)
          : <File className="w-3.5 h-3.5 text-muted/60 flex-shrink-0" />}
        <span className="text-xs font-mono text-text truncate">{entry.name}</span>
      </button>
      {open && (
        <div>
          {loading && <p className="text-xs font-mono text-muted/50 pl-6 py-0.5">loading…</p>}
          {children?.map(c => <Node key={c.path} entry={c} depth={depth + 1} onFileClick={onFileClick} />)}
          {children && children.length === 0 && !loading && (
            <p className="text-xs font-mono text-muted/40 py-0.5" style={{ paddingLeft: (depth + 1) * 12 + 16 }}>empty</p>
          )}
        </div>
      )}
    </div>
  )
}

export function FolderTree({ rootPath, onFileClick }: Props) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await invoke<DirEntry[]>('list_directory', { path: rootPath })
      setEntries(list)
    } catch { setEntries([]) }
    setLoading(false)
  }, [rootPath])

  useEffect(() => { load() }, [load])

  return (
    <div className="w-60 flex flex-col bg-surface border-r border-white/5 flex-shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-xs font-mono font-bold text-text">Folder</span>
        <button onClick={load}
          className="p-1 text-muted hover:text-accent cursor-pointer rounded transition-colors" title="Refresh">
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {entries.length === 0 && !loading ? (
          <p className="text-xs font-mono text-muted/50 text-center py-4">Empty</p>
        ) : (
          entries.map(e => <Node key={e.path} entry={e} depth={0} onFileClick={onFileClick} />)
        )}
      </div>
    </div>
  )
}
