'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Send,
  Users,
  ShieldCheck,
  QrCode,
  Settings,
} from 'lucide-react';

const navItems = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Dashboard',
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
    href: '/settings',
    icon: Settings,
    label: 'Configurações',
    selector: '#nav-settings'
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
  const { isMobile, setOpenMobile } = useSidebar();

  const handleMobileClick = () => {
    // Close sidebar on mobile when a link is clicked
    if (isMobile) {
      setOpenMobile(false);
    }
  };

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
            <Link href={item.href} onClick={handleMobileClick}>
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
                <Link href={item.href} onClick={handleMobileClick}>
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
