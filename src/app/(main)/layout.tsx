'use client';
import React, { useEffect } from 'react';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarInset } from '@/components/ui/sidebar';
import { MainNav } from '@/components/main-nav';
import { UserMenu } from '@/components/user-menu';
import { Logo } from '@/components/logo';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { TutorialProvider } from '@/components/tutorial-provider';
import { WelcomeTour } from '@/components/welcome-tour';


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
    <TutorialProvider>
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
          <SidebarInset>
            <div className='p-4 md:p-6'>
              {children}
            </div>
            <footer className="fixed bottom-0 left-0 md:left-[var(--sidebar-width-icon)] w-full peer-data-[variant=inset]:md:left-[calc(var(--sidebar-width-icon)+theme(spacing.2))] transition-[left] duration-200 ease-linear group-data-[state=expanded]:md:left-[var(--sidebar-width)] peer-data-[state=expanded]:peer-data-[variant=inset]:md:left-[calc(var(--sidebar-width)+theme(spacing.2))] bg-background/80 backdrop-blur-sm z-10">
              <div className="text-center text-xs text-muted-foreground p-2 border-t">
                Sistema de automação não-oficial. Use com moderação.
              </div>
            </footer>
          </SidebarInset>
      </SidebarProvider>
      <WelcomeTour />
    </TutorialProvider>
  );
}
