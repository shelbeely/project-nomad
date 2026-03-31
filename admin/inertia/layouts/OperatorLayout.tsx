import {
  IconRobot,
  IconListDetails,
  IconBolt,
  IconClipboardList,
  IconTerminal2,
} from '@tabler/icons-react'
import StyledSidebar from '~/components/StyledSidebar'

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  const navigation = [
    { name: 'Workspace', href: '/operator', icon: IconBolt, current: false },
    { name: 'Agent Console', href: '/agent', icon: IconRobot, current: false },
    { name: 'Tool Explorer', href: '/agent/tools', icon: IconListDetails, current: false },
    { name: 'Task History', href: '/operator#history', icon: IconClipboardList, current: false },
    { name: 'API Reference', href: '/agents.md', icon: IconTerminal2, current: false, target: '_blank' },
  ]

  return (
    <div className="min-h-screen flex flex-row bg-surface-secondary/90">
      <StyledSidebar title="AI Operator" items={navigation} />
      {children}
    </div>
  )
}
