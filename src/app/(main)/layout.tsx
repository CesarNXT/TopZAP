'use client';
import React, { useEffect } from 'react';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
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
    <SidebarProvider open={true}>
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
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1 md:hidden" />
            <Separator orientation="vertical" className="mr-2 h-4 md:hidden" />
          </header>
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
