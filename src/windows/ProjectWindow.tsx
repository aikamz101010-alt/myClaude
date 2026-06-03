import { useState, useCallback, useEffect, useRef } from 'react'
import { ChatView } from '@/components/project/ChatView'
import { FolderTree } from '@/components/project/FolderTree'
import { FileEditor } from '@/components/project/FileEditor'
import { TerminalView } from '@/components/project/TerminalView'
import { ContractEditor, type ContractEditorHandle } from '@/components/project/ContractEditor'
import { ContractPanel } from '@/components/project/ContractPanel'
import { LibraryPanel } from '@/components/library/LibraryPanel'
import { AddFromURL } from '@/components/library/AddFromURL'
import { Avatar3DView } from '@/components/project/Avatar3DView'
import { CharacterView } from '@/components/project/CharacterView'
import { useSessionStore } from '@/store/sessionStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useAvatarStore } from '@/store/avatarStore'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { cn } from '@/lib/utils'
import { MessageSquare, Terminal, FileText, ArrowLeft, Circle, Plus, X, Folder, Bot, PersonStanding } from 'lucide-react'
import type { Project } from '@/store/projectStore'
import type { SkillItem } from '@/store/libraryStore'

interface Props {
  project: Project
  onBack: () => void
}

type Tab = 'chat' | 'terminal' | 'contract' | 'character'

const BUILTIN_COMMANDS = ['init', 'review', 'security-review', 'compact', 'clear', 'context', 'cost', 'help', 'model', 'agents', 'mcp', 'resume']

export function ProjectWindow({ project, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('chat')
  const [showAddURL, setShowAddURL] = useState(false)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [showFolder, setShowFolder] = useState(false)  // folder tree collapsed by default
  const [charOpened, setCharOpened] = useState(false)  // mount Character panel once, then keep it
  const [openFiles, setOpenFiles] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const contractRef = useRef<ContractEditorHandle>(null)

  const openFile = (path: string) => {
    setOpenFiles(prev => prev.includes(path) ? prev : [...prev, path])
    setActiveFile(path)
  }
  const closeFile = (path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(p => p !== path)
      if (activeFile === path) setActiveFile(next[next.length - 1] ?? null)
      return next
    })
  }
  const fileName = (p: string) => p.split('/').pop() ?? p

  const { ptyStatus, chatsByProject, chats, createChat, closeChat, sendMessageStream } = useSessionStore()
  const { items } = useLibraryStore()
  const avatarEnabled = useAvatarStore(s => s.enabled)
  const toggleAvatar = useAvatarStore(s => s.toggleEnabled)
  const ptyRunning = ptyStatus[project.id] === 'running'

  // Slash commands = skills + builtin
  const slashCommands = [
    ...BUILTIN_COMMANDS,
    ...items.filter(i => i.item_type === 'skill').map(i => i.name),
  ]

  const projectChatIds = chatsByProject[project.id] ?? []
  const projectChats = projectChatIds.map(id => chats[id]).filter(Boolean)

  // On entering a project: reuse existing session tabs — only create a new
  // chat if the project has NONE. Prefer the active session (with messages
  // or a live session id) instead of always the first.
  useEffect(() => {
    if (projectChatIds.length === 0) {
      const id = createChat(project.id, project.path)
      setActiveChatId(id)
    } else if (!activeChatId || !projectChatIds.includes(activeChatId)) {
      const activeSession = projectChatIds.find(id => {
        const c = chats[id]
        return c && (c.status === 'streaming' || c.messages.length > 0 || c.sessionId)
      })
      setActiveChatId(activeSession ?? projectChatIds[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, projectChatIds.length])

  // Mount the Character panel the first time it's opened, then keep it mounted
  // (hidden) so it doesn't re-initialize / reload the VRM on every tab switch.
  useEffect(() => { if (tab === 'character') setCharOpened(true) }, [tab])

  const handleNewChat = () => {
    const id = createChat(project.id, project.path)
    setActiveChatId(id)
  }

  const handleCloseChat = (chatId: string) => {
    const remaining = projectChatIds.filter(id => id !== chatId)
    closeChat(chatId)
    if (activeChatId === chatId) {
      setActiveChatId(remaining[0] ?? null)
    }
  }

  // Click a library item → add to the contract (zone derived from type)
  const handleAddToContract = useCallback((item: SkillItem) => {
    const zone = item.item_type === 'agent' ? 'agent'
      : (item.item_type === 'plugin' || item.item_type === 'mcp') ? 'mcp'
      : 'skill'
    contractRef.current?.addItem(zone, { id: item.id, name: item.name, item_type: zone })
  }, [])

  // Generate PRD / TRD via a chat session (no auto-edit to Custom Rules)
  const handleGenerateDoc = useCallback((type: 'PRD' | 'TRD') => {
    const id = createChat(project.id, project.path, `${type} draft`)
    setActiveChatId(id)
    setTab('chat')

    const prompt = type === 'PRD'
      ? `Analyze this project's codebase, then create a comprehensive Product Requirements Document and save it to PRD.md in the project root. Cover: Overview, Problem Statement, Goals & Objectives, Target Users, Features & Requirements, User Stories, Success Metrics, and Scope/Non-Goals.`
      : `Analyze this project's codebase and architecture, then create a comprehensive Technical Requirements Document and save it to TRD.md in the project root. Cover: System Overview, Architecture, Tech Stack, Components/Modules, Data Models, APIs/Interfaces, Dependencies, Security, Performance, and Deployment.`

    setTimeout(() => sendMessageStream(id, prompt), 150)
  }, [createChat, project.id, project.path, sendMessageStream])

  const tabs: { key: Tab; icon: typeof MessageSquare; label: string; dot?: boolean }[] = [
    { key: 'chat',      icon: MessageSquare,  label: 'Chat'      },
    { key: 'terminal',  icon: Terminal,       label: 'Terminal', dot: ptyRunning },
    { key: 'character', icon: PersonStanding, label: 'Character' },
    { key: 'contract',  icon: FileText,       label: 'Contract'  },
  ]

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden">

        {/* Titlebar */}
        <div className="titlebar-drag flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0" style={{ height: 40 }} data-tauri-drag-region>
          <div className="titlebar-no-drag flex items-center gap-2" style={{ marginLeft: 72 }}>
            <button onClick={onBack} className="p-1 text-muted hover:text-text cursor-pointer transition-colors rounded">
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-sm font-bold text-text">{project.name}</span>
            <span className="text-xs text-muted font-mono truncate max-w-[200px]">{project.path}</span>
          </div>

          <div className="titlebar-no-drag flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              {tabs.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={cn('relative flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer transition-colors',
                    tab === t.key ? 'bg-surface2 text-text' : 'text-muted hover:text-text')}>
                  <t.icon className="w-3 h-3" />
                  {t.label}
                  {t.dot && <Circle className="w-1.5 h-1.5 fill-accent text-accent absolute -top-0.5 -right-0.5" />}
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-white/10" />
            <button onClick={toggleAvatar}
              title={avatarEnabled ? 'Hide talking avatar' : 'Show talking avatar'}
              className={cn('p-1 rounded-lg cursor-pointer transition-colors',
                avatarEnabled ? 'text-accent' : 'text-muted hover:text-text')}>
              <Bot className="w-3.5 h-3.5" />
            </button>
            <ThemeToggle />
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Chat sub-tab strip (multi chat windows) */}
            {tab === 'chat' && (
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5 bg-surface/30 flex-shrink-0 overflow-x-auto">
                {/* Folder tree toggle — before chat tabs */}
                <button onClick={() => setShowFolder(v => !v)}
                  className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono cursor-pointer transition-colors flex-shrink-0 border',
                    showFolder ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted hover:text-text border-white/10')}
                  title="Toggle folder structure">
                  <Folder className="w-3.5 h-3.5" />
                  Folder
                </button>
                <div className="w-px h-4 bg-white/10 flex-shrink-0" />
                {projectChats.map(c => (
                  <div key={c.id}
                    className={cn(
                      'group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg cursor-pointer transition-colors flex-shrink-0 max-w-[180px]',
                      !activeFile && activeChatId === c.id ? 'bg-surface2 text-text' : 'text-muted hover:text-text hover:bg-surface2/40',
                    )}
                    onClick={() => { setActiveFile(null); setActiveChatId(c.id) }}>
                    <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                      c.status === 'streaming' ? 'bg-accent animate-pulse' : c.sessionId ? 'bg-accent/50' : 'bg-muted/40')} />
                    <span className="text-xs font-mono truncate">{c.title}</span>
                    {projectChats.length > 1 && (
                      <button onClick={e => { e.stopPropagation(); handleCloseChat(c.id) }}
                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-error transition-all flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={handleNewChat}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono text-muted hover:text-accent hover:bg-surface2/40 cursor-pointer transition-colors flex-shrink-0"
                  title="New chat (separate session)">
                  <Plus className="w-3.5 h-3.5" />
                </button>

                {/* Open file tabs */}
                {openFiles.length > 0 && <div className="w-px h-4 bg-white/10 flex-shrink-0" />}
                {openFiles.map(f => (
                  <div key={f}
                    className={cn(
                      'group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg cursor-pointer transition-colors flex-shrink-0 max-w-[180px] border',
                      activeFile === f
                        ? 'bg-accent/15 text-accent border-accent/40'
                        : 'text-accent/70 border-accent/15 hover:bg-accent/10 hover:text-accent',
                    )}
                    onClick={() => setActiveFile(f)}
                    title={f}>
                    <FileText className="w-3 h-3 flex-shrink-0" />
                    <span className="text-xs font-mono truncate">{fileName(f)}</span>
                    <button onClick={e => { e.stopPropagation(); closeFile(f) }}
                      className="opacity-0 group-hover:opacity-100 text-accent/60 hover:text-error transition-all flex-shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Chat area: optional folder sidebar + (chat windows OR file editor) */}
            <div className={cn('flex-1 overflow-hidden', tab === 'chat' ? 'flex' : 'hidden')}>
              {showFolder && (
                <FolderTree rootPath={project.path} onFileClick={openFile} />
              )}
              <div className="flex-1 overflow-hidden relative">
                {/* Chat windows (hidden when a file is active) */}
                <div className={activeFile ? 'hidden' : 'h-full'}>
                  {projectChats.map(c => (
                    <div key={c.id} className={activeChatId === c.id ? 'h-full' : 'hidden'}>
                      <ChatView chatId={c.id} slashCommands={slashCommands} />
                    </div>
                  ))}
                </div>
                {/* File editor (when a file tab is active) */}
                {activeFile && <FileEditor key={activeFile} path={activeFile} />}

                {/* Talking VRM avatar — floats over the chat, narrates replies */}
                {tab === 'chat' && avatarEnabled && !activeFile && (
                  <Avatar3DView chatId={activeChatId} onClose={() => toggleAvatar()} />
                )}
              </div>
            </div>

            {/* Terminal */}
            <div className={cn('flex-1 overflow-hidden', tab === 'terminal' ? 'block' : 'hidden')}>
              <TerminalView projectId={project.id} workingDir={project.path} autoStart={tab === 'terminal'} />
            </div>

            {/* Character panel — mounted once then kept (hidden) so it never
                re-initializes / reloads the VRM when switching tabs */}
            {charOpened && (
              <div className={cn('flex-1 overflow-hidden', tab === 'character' ? 'block' : 'hidden')}>
                <CharacterView chatId={activeChatId} slashCommands={slashCommands} active={tab === 'character'} />
              </div>
            )}

            {tab === 'contract' && (
              <div className="flex-1 overflow-hidden">
                <ContractEditor ref={contractRef} contractPath={project.contract_path} onGenerateDoc={handleGenerateDoc} />
              </div>
            )}
          </div>

          {tab === 'chat'
            ? <ContractPanel contractPath={project.contract_path} activeChatId={activeChatId} />
            : tab === 'character'
              ? null
              : <LibraryPanel onAddFromURL={() => setShowAddURL(true)} onItemClick={tab === 'contract' ? handleAddToContract : undefined} />}
        </div>

        {showAddURL && <AddFromURL onClose={() => setShowAddURL(false)} />}
      </div>
  )
}
