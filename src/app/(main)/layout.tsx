'use client';
import React, { useEffect } from 'react';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarInset } from '@/components/ui/sidebar';
import { MainNav } from '@/components/main-nav';
import { UserMenu } from '@/components/user-menu';
import { Logo } from '@/components/logo';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';


export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <Logo />
          </SidebarHeader>
          <SidebarContent className="p-2 flex flex-col">
            <MainNav />
          </SidebarContent>
          <SidebarFooter>
            <UserMenu />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="flex flex-col min-h-screen">
          <div className='flex-1 p-4 md:p-6'>
            {children}
          </div>
          <footer className="w-full border-t bg-background/80 p-2 text-center text-xs text-muted-foreground backdrop-blur-sm">
            Sistema de automação não-oficial. Use com moderação.
          </footer>
        </SidebarInset>
    </SidebarProvider>
  );
}
