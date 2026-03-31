import {
  IconRobot,
  IconTerminal2,
  IconTools,
  IconActivity,
} from '@tabler/icons-react'
import StyledSidebar from '~/components/StyledSidebar'

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const navigation = [
    { name: 'Status', href: '/agent', icon: IconActivity, current: false },
    { name: 'Agent Runner', href: '/agent/run', icon: IconRobot, current: false },
    { name: 'Tool Explorer', href: '/agent/tools', icon: IconTools, current: false },
    { name: 'API Reference', href: '/agents.md', icon: IconTerminal2, current: false, target: '_blank' },
  ]

  return (
    <div className="min-h-screen flex flex-row bg-surface-secondary/90">
      <StyledSidebar title="Agent Console" items={navigation} />
      {children}
    </div>
  )
}
