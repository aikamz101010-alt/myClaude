import { useState, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { Zap, Bot, Plug, X, Save, Code, Check } from 'lucide-react'
import type { SkillItem } from '@/store/libraryStore'

interface ContractItem {
  id: string
  name: string
  item_type: string
}

interface DropZoneProps {
  zoneId: string
  label: string
  items: ContractItem[]
  onRemove: (id: string) => void
}

function DropZone({ zoneId, label, items, onRemove }: DropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId })
  const iconMap: Record<string, React.ElementType> = {
    skill: Zap,
    agent: Bot,
    mcp:   Plug,
  }

  return (
    <div className="mb-5">
      <h3 className="text-xs font-mono font-semibold text-muted uppercase tracking-wider mb-2">
        {label}
      </h3>
      <div
        ref={setNodeRef}
        className={cn(
          'min-h-14 p-2 rounded-xl border-2 border-dashed transition-all duration-200',
          'flex flex-wrap gap-2 items-start content-start',
          isOver
            ? 'border-accent bg-accent/5 shadow-[0_0_16px_rgba(34,197,94,0.2)]'
            : 'border-white/10 hover:border-white/20',
        )}
      >
        {items.map((item) => {
          const Icon = iconMap[item.item_type] ?? Zap
          return (
            <div
              key={item.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface2 border border-white/10 group/chip"
            >
              <Icon className="w-3 h-3 text-accent flex-shrink-0" />
              <span className="text-xs font-mono text-text">{item.name}</span>
              <button
                onClick={() => onRemove(item.id)}
                className="opacity-0 group-hover/chip:opacity-100 cursor-pointer text-muted hover:text-error transition-all ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        {items.length === 0 && (
          <p className="text-xs text-muted/60 font-mono self-center w-full text-center py-1">
            Drop {label.toLowerCase()} here
          </p>
        )}
      </div>
    </div>
  )
}

interface Props {
  contractPath: string
  onDrop?: (item: SkillItem) => void
}

export function ContractEditor({ contractPath }: Props) {
  const [items, setItems] = useState<Record<string, ContractItem[]>>({
    skill: [],
    agent: [],
    mcp:   [],
  })
  const [rawMode, setRawMode] = useState(false)
  const [rawContent, setRawContent] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    invoke<string>('read_contract', { contractPath })
      .then(setRawContent)
      .catch(() => setRawContent(''))
  }, [contractPath])

  const removeItem = (zone: string, id: string) => {
    setItems((prev) => ({
      ...prev,
      [zone]: prev[zone].filter((i) => i.id !== id),
    }))
  }

  const buildContractMd = () => {
    const lines = (zone: string) =>
      items[zone].map((i) => `- ${i.name}`).join('\n')
    return [
      '# Allowed Skills',
      lines('skill') || '',
      '',
      '# Active Agents',
      lines('agent') || '',
      '',
      '# MCP Plugins',
      lines('mcp') || '',
      '',
    ].join('\n')
  }

  const handleSave = async () => {
    const content = rawMode ? rawContent : buildContractMd()
    try {
      await invoke('write_contract', { contractPath, content })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('Save failed:', e)
    }
  }

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="text-sm font-mono font-bold text-text">CONTRACT.md</h2>
          <p className="text-xs text-muted font-mono">{contractPath}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRawMode((m) => !m)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors',
              rawMode
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'text-muted hover:text-text hover:bg-surface2/50',
            )}
          >
            <Code className="w-3 h-3" /> Raw
          </button>
          <button
            onClick={handleSave}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold cursor-pointer transition-all duration-200',
              saved
                ? 'bg-accent text-bg'
                : 'bg-surface2 text-text hover:bg-surface border border-white/10',
            )}
          >
            {saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {rawMode ? (
          <textarea
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
            className={cn(
              'w-full h-full min-h-64 bg-surface2 rounded-xl p-3',
              'text-xs font-mono text-text resize-none',
              'focus:outline-none focus:ring-1 focus:ring-accent/40',
            )}
            placeholder="# Allowed Skills&#10;- skill-name&#10;&#10;# Active Agents&#10;- agent-name"
          />
        ) : (
          <>
            <DropZone
              zoneId="skill"
              label="Skills"
              items={items.skill}
              onRemove={(id) => removeItem('skill', id)}
            />
            <DropZone
              zoneId="agent"
              label="Agents"
              items={items.agent}
              onRemove={(id) => removeItem('agent', id)}
            />
            <DropZone
              zoneId="mcp"
              label="MCP Plugins"
              items={items.mcp}
              onRemove={(id) => removeItem('mcp', id)}
            />

            {/* Preview */}
            <div className="mt-4">
              <h3 className="text-xs font-mono font-semibold text-muted uppercase tracking-wider mb-2">
                Output Preview
              </h3>
              <pre className="bg-surface2 rounded-xl p-3 text-xs font-mono text-muted whitespace-pre-wrap">
                {buildContractMd()}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Export addItem ref helper for ProjectWindow to call when drag ends
export type { ContractItem }
