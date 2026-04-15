import {
  IconFileText,
  IconNotes,
  IconReport,
  IconFile,
  IconDownload,
} from '@tabler/icons-react'
import { useState } from 'react'

export type Artifact = {
  id: number
  task_id: number
  type: 'note' | 'summary' | 'report' | 'file'
  title: string
  content: string
  created_at: string
}

function ArtifactTypeIcon({ type }: { type: Artifact['type'] }) {
  if (type === 'note') return <IconNotes size={14} className="text-blue-400 shrink-0" />
  if (type === 'summary') return <IconFileText size={14} className="text-green-400 shrink-0" />
  if (type === 'report') return <IconReport size={14} className="text-purple-400 shrink-0" />
  return <IconFile size={14} className="text-text-secondary shrink-0" />
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [expanded, setExpanded] = useState(false)

  const handleDownload = () => {
    const blob = new Blob([artifact.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="border border-surface-primary rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-secondary/30">
        <ArtifactTypeIcon type={artifact.type} />
        <span className="text-sm font-medium text-text-primary flex-1 truncate">{artifact.title}</span>
        <span className="text-[10px] text-text-secondary font-mono capitalize">{artifact.type}</span>
        <button
          onClick={() => setExpanded((o) => !o)}
          className="text-xs text-text-secondary hover:text-text-primary transition-colors px-1"
        >
          {expanded ? 'hide' : 'view'}
        </button>
        <button
          onClick={handleDownload}
          className="text-text-secondary hover:text-desert-green transition-colors"
          title="Download artifact"
        >
          <IconDownload size={13} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 py-2 bg-surface-secondary/10 max-h-48 overflow-y-auto">
          <pre className="text-xs text-text-primary whitespace-pre-wrap break-words">{artifact.content}</pre>
        </div>
      )}
    </div>
  )
}

export default function ArtifactsPanel({ artifacts }: { artifacts: Artifact[] }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-1 shrink-0">
        <IconFileText size={13} /> Artifacts ({artifacts.length})
      </h2>
      {artifacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-4 text-center">
          <IconFileText size={20} className="text-text-secondary mb-1" />
          <p className="text-xs text-text-secondary">No artifacts yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1">
          {artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      )}
    </div>
  )
}
