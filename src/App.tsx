import { useState } from 'react'
import { Hub } from './windows/Hub'
import { ProjectWindow } from './windows/ProjectWindow'
import './styles/globals.css'
import type { Project } from './store/projectStore'

function App() {
  const [activeProject, setActiveProject] = useState<Project | null>(null)

  if (activeProject) {
    return (
      <ProjectWindow
        project={activeProject}
        onBack={() => setActiveProject(null)}
      />
    )
  }

  return <Hub onOpenProject={setActiveProject} />
}

export default App
