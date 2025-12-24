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
      className="flex items-center justify-center gap-2.5 font-semibold text-foreground p-2"
    >
      <Image 
        src="https://files.catbox.moe/w98d31.png"
        alt="TOPzap Logo"
        width={0}
        height={0}
        sizes="100vw"
        className={cn(
          'transition-all duration-200 object-contain',
          state === 'collapsed' ? 'opacity-0 w-0 h-0 overflow-hidden' : 'opacity-100 w-auto h-[50px]'
        )}
        unoptimized
        priority
      />
    </Link>
  );
}
