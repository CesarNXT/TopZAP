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
  ShieldCheck,
  QrCode,
} from 'lucide-react';

const navItems = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Painel',
    selector: '#nav-dashboard'
  },
  {
    href: '/campaigns',
    icon: Send,
    label: 'Campanhas',
    selector: '#nav-campaigns'
  },
  {
    href: '/contacts',
    icon: Users,
    label: 'Contatos',
    selector: '#nav-contacts'
  },
  {
    href: '/whatsapp-connect',
    icon: QrCode,
    label: 'Conectar',
    selector: '#tour-connect-wa'
  },
];

const secondaryNavItems = [
    {
        href: '/safety',
        icon: ShieldCheck,
        label: 'Segurança',
        selector: '#nav-safety'
    },
]

export function MainNav() {
  const pathname = usePathname();

  return (
    <>
    <SidebarMenu>
      {navItems.map((item) => (
        <SidebarMenuItem key={item.href} id={item.selector.substring(1)}>
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
            <SidebarMenuItem key={item.href} id={item.selector.substring(1)}>
            <SidebarMenuButton
                asChild
                isActive={pathname === item.href}
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
    </>
  );
}
