'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Send,
  Users,
  Settings,
  ShieldCheck,
  QrCode,
  BookOpen,
} from 'lucide-react';
import { useTutorial } from './tutorial-provider';

const navItems = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Painel',
  },
  {
    href: '/campaigns',
    icon: Send,
    label: 'Campanhas',
  },
  {
    href: '/contacts',
    icon: Users,
    label: 'Contatos',
  },
  {
    href: '/whatsapp-connect',
    icon: QrCode,
    label: 'Conectar',
  },
];

const secondaryNavItems = [
    {
        href: '/tutorial',
        icon: BookOpen,
        label: 'Tutorial',
    },
    {
        href: '/safety',
        icon: ShieldCheck,
        label: 'Segurança',
    },
    {
        href: '/settings',
        icon: Settings,
        label: 'Configurações',
    },
]

export function MainNav() {
  const pathname = usePathname();
  const { startTutorial } = useTutorial();

  const handleTutorialClick = (e: React.MouseEvent) => {
    if (pathname !== '/tutorial') {
        // Allow navigation if not on the page
        return;
    }
    e.preventDefault();
    startTutorial();
  }

  return (
    <>
    <SidebarMenu>
      {navItems.map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            asChild
            isActive={pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))}
            tooltip={item.label}
          >
            <Link href={item.href}>
              <item.icon />
              <span>{item.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
    <div className='flex-grow' />
    <SidebarMenu>
        {secondaryNavItems.map((item) => (
            <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
                asChild
                isActive={pathname === item.href}
                tooltip={item.label}
            >
                <Link href={item.href} onClick={item.href === '/tutorial' ? handleTutorialClick : undefined}>
                    <item.icon />
                    <span>{item.label}</span>
                </Link>
            </SidebarMenuButton>
            </SidebarMenuItem>
        ))}
    </SidebarMenu>
    </>
  );
}
