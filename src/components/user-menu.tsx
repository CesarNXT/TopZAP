'use client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { useSidebar } from './ui/sidebar';
import { cn } from '@/lib/utils';
import { useAuth, useUser } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';

export function UserMenu() {
  const { state } = useSidebar();
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex w-full items-center justify-between p-2 gap-2">
      <div className="flex items-center gap-2 overflow-hidden">
        <Avatar className="h-8 w-8">
          <AvatarImage src={user.photoURL || `https://picsum.photos/seed/${user.uid}/40/40`} alt={user.displayName || 'User'} />
          <AvatarFallback>{user.displayName?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}</AvatarFallback>
        </Avatar>
        
        <div className={cn('flex flex-col items-start truncate', state === 'collapsed' ? 'hidden' : 'flex')}>
              <span className="text-sm font-medium truncate">{user.displayName || 'Usuário'}</span>
              <span className="text-xs text-muted-foreground truncate">
                  {user.email}
              </span>
        </div>
      </div>
      
      <Button
        variant="ghost"
        size="icon"
        onClick={handleSignOut}
        className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', state === 'collapsed' ? 'hidden' : 'flex')}
        title="Sair"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
