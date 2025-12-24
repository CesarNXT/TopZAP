'use client';

import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import Image from 'next/image';

export function Logo() {
  const { state } = useSidebar();
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 font-semibold text-foreground"
    >
      <Image 
        src="https://files.catbox.moe/1isrb2.png"
        alt="TOPzap Logo"
        width={210}
        height={60}
        className={cn(
          'transition-opacity duration-200',
          state === 'collapsed' ? 'opacity-0 w-0' : 'opacity-100 w-auto'
        )}
        style={{ width: 'auto', height: '60px' }}
        unoptimized
      />
    </Link>
  );
}
