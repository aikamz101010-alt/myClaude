import { useState, useEffect, useCallback } from 'react'
import { DndContext, DragEndEvent } from '@dnd-kit/core'
import { useAgentStore } from '@/store/agentStore'
import { ChatView } from '@/components/project/ChatView'
import { TerminalView } from '@/components/project/TerminalView'
import { ContractEditor } from '@/components/project/ContractEditor'
import { LibraryPanel } from '@/components/library/LibraryPanel'
import { AddFromURL } from '@/components/library/AddFromURL'
import { LocalMonitor } from '@/components/project/LocalMonitor'
import { cn } from '@/lib/utils'
import {
  MessageSquare,
  Terminal,
  FileText,
  Play,
  Square,
  ArrowLeft,
} from 'lucide-react'
import type { Project } from '@/store/projectStore'
import type { SkillItem } from '@/store/libraryStore'

interface Props {
  project: Project
  onBack: () => void
}

type WorkspaceTab = 'chat' | 'terminal' | 'contract'

export function ProjectWindow({ project, onBack }: Props) {
  const [tab, setTab] = useState<WorkspaceTab>('chat')
  const [isTerminalMode, setIsTerminalMode] = useState(false)
  const [_contractItems, setContractItems] = useState<
    Record<string, Array<{ id: string; name: string; item_type: string }>>
  >({ skill: [], agent: [], mcp: [] })
  const [showAddURL, setShowAddURL] = useState(false)
  const { spawnAgent, stopAgent, statuses, subscribeOutput } = useAgentStore()
  const status = statuses[project.id] ?? 'idle'

  useEffect(() => {
    const unsub = subscribeOutput(project.id)
    return unsub
  }, [project.id])

  const handleStart = async () => {
    await spawnAgent(project.id, project.path)
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || !active.data.current) return

    const item = active.data.current.item as SkillItem
    const zoneId = over.id as string // 'skill' | 'agent' | 'mcp'

    if (!['skill', 'agent', 'mcp'].includes(zoneId)) return
    // Only add if zone matches item type (or allow any → zone)
    const targetZone = zoneId

    setContractItems((prev) => {
      if (prev[targetZone]?.some((i) => i.id === item.id)) return prev
      return {
        ...prev,
        [targetZone]: [...(prev[targetZone] ?? []), {
          id: item.id,
          name: item.name,
          item_type: item.item_type,
        }],
      }
    })
  }, [])

  const tabs = [
    { key: 'chat'     as const, icon: MessageSquare, label: 'Chat'     },
    { key: 'terminal' as const, icon: Terminal,      label: 'Terminal' },
    { key: 'contract' as const, icon: FileText,      label: 'Contract' },
  ]

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-screen bg-bg overflow-hidden">
        {/* Titlebar */}
        <div
          className="titlebar-drag flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0"
          style={{ height: 40 }}
          data-tauri-drag-region
        >
          <div className="titlebar-no-drag flex items-center gap-2" style={{ marginLeft: 72 }}>
            <button
              onClick={onBack}
              className="p-1 text-muted hover:text-text cursor-pointer transition-colors rounded"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-sm font-bold text-text">{project.name}</span>
            <div
              className={cn('w-2 h-2 rounded-full flex-shrink-0', {
                'bg-accent animate-pulse': status === 'running',
                'bg-muted':               status === 'idle',
                'bg-error':               status === 'error',
              })}
            />
          </div>

          <div className="titlebar-no-drag flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer transition-colors',
                  tab === t.key
                    ? 'bg-surface2 text-text'
                    : 'text-muted hover:text-text',
                )}
              >
                <t.icon className="w-3 h-3" />
                {t.label}
              </button>
            ))}

            {tab === 'chat' && (
              <button
                onClick={() => setIsTerminalMode((m) => !m)}
                className={cn(
                  'ml-1 px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors border',
                  isTerminalMode
                    ? 'text-accent bg-accent/10 border-accent/20'
                    : 'text-muted border-white/10 hover:text-text',
                )}
              >
                {isTerminalMode ? 'Terminal' : 'Chat'}
              </button>
            )}

            <div className="w-px h-4 bg-white/10 mx-1" />

            {status === 'running' ? (
              <button
                onClick={() => stopAgent(project.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-error/10 text-error hover:bg-error/20 cursor-pointer transition-colors border border-error/20"
              >
                <Square className="w-3 h-3" /> Stop
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-accent/10 text-accent hover:bg-accent hover:text-bg cursor-pointer transition-colors border border-accent/20 glow-accent"
              >
                <Play className="w-3 h-3" /> Start
              </button>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {tab === 'chat' && (
              isTerminalMode
                ? <TerminalView projectId={project.id} />
                : <ChatView projectId={project.id} workingDir={project.path} />
            )}
            {tab === 'terminal' && <TerminalView projectId={project.id} />}
            {tab === 'contract' && (
              <ContractEditor contractPath={project.contract_path} />
            )}
          </div>
          <LibraryPanel onAddFromURL={() => setShowAddURL(true)} />
        </div>

        {/* Bottom monitor strip */}
        <LocalMonitor projectId={project.id} />

        {/* AddFromURL modal */}
        {showAddURL && <AddFromURL onClose={() => setShowAddURL(false)} />}
      </div>
    </DndContext>
  )
}
