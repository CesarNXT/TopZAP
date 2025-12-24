'use client';

import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';

const LOCAL_STORAGE_KEY = 'welcomeTourCompleted';

interface TutorialContextType {
  isTourOpen: boolean;
  startTutorial: () => void;
  completeTutorial: () => void;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [isTourOpen, setIsTourOpen] = useState(false);

  const startTutorial = useCallback(() => {
    setIsTourOpen(true);
  }, []);

  const completeTutorial = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, 'true');
    } catch (error) {
      console.warn("Could not access localStorage to save tour state.", error);
    }
    setIsTourOpen(false);
  }, []);

  return (
    <TutorialContext.Provider value={{ isTourOpen, startTutorial, completeTutorial }}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (context === undefined) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return context;
}
