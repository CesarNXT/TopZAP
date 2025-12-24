'use client';

import { cn } from '@/lib/utils';
import React from 'react';

export function RocketLaunch() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
      <div className="animate-launch">
        <span className="text-6xl">🚀</span>
      </div>
      <style jsx>{`
        @keyframes launch {
          0% {
            transform: translateY(200px) rotate(-45deg);
            opacity: 0;
          }
          20% {
            transform: translateY(0) rotate(-45deg);
            opacity: 1;
          }
          80% {
            transform: translateY(-80vh) rotate(-45deg);
            opacity: 1;
          }
          100% {
            transform: translateY(-100vh) rotate(-45deg);
            opacity: 0;
          }
        }
        .animate-launch {
          animation: launch 2.5s ease-in forwards;
        }
      `}</style>
    </div>
  );
}
