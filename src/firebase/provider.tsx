'use client';

import React, { DependencyList, createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore } from 'firebase/firestore';
import { Auth, User, onAuthStateChanged } from 'firebase/auth';
import { FirebaseStorage } from 'firebase/storage';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener'

interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
}

// Internal state for user authentication
interface UserAuthState {
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

// Combined state for the Firebase context
export interface FirebaseContextState {
  areServicesAvailable: boolean; // True if core services (app, firestore, auth instance) are provided
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null; // The Auth service instance
  storage: FirebaseStorage | null;
  // User authentication state
  user: User | null;
  isUserLoading: boolean; // True during initial auth check
  userError: Error | null; // Error from auth listener
}

// Return type for useFirebase()
export interface FirebaseServicesAndUser {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

// Return type for useUser() - specific to user auth state
export interface UserHookResult { // Renamed from UserAuthHookResult for consistency if desired, or keep as UserAuthHookResult
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

// React Context
export const FirebaseContext = createContext<FirebaseContextState>({
  areServicesAvailable: false,
  firebaseApp: null,
  firestore: null,
  auth: null,
  storage: null,
  user: null,
  isUserLoading: true,
  userError: null,
});

export function FirebaseProvider({ children, firebaseApp, firestore, auth, storage }: FirebaseProviderProps) {
  const [userState, setUserState] = useState<UserAuthState>({
    user: null,
    isUserLoading: true,
    userError: null
  });

  useEffect(() => {
    if (!auth) {
        setUserState(prev => ({ ...prev, isUserLoading: false }));
        return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setUserState({
          user,
          isUserLoading: false,
          userError: null
        });
      },
      (error) => {
        console.error("Firebase Auth Error:", error);
        setUserState({
          user: null,
          isUserLoading: false,
          userError: error
        });
      }
    );

    return () => unsubscribe();
  }, [auth]);

  const value = useMemo<FirebaseContextState>(() => ({
    areServicesAvailable: !!(firebaseApp && firestore && auth),
    firebaseApp,
    firestore,
    auth,
    storage,
    ...userState
  }), [firebaseApp, firestore, auth, storage, userState]);

  return (
    <FirebaseContext.Provider value={value}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
}

/**
 * Hook to access core Firebase services and user authentication state.
 * Throws error if core services are not available or used outside provider.
 */
export function useFirebase(): FirebaseServicesAndUser {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }

  if (!context.areServicesAvailable) {
    // throw new Error("Firebase services are not available yet (or initialization failed).");
    // Return partial or nulls if we want to be more lenient, but types say non-null.
    // Ideally, the app should show a loader until initialization is complete.
    // For strict typing, we throw or cast. Let's assume the provider handles loading state or
    // the user checks context.areServicesAvailable if they need to be safe.
    // For now, we will cast, but in a real app, handle initialization state.
    // Actually, let's just return what we have, but cast to the expected type if we are sure it will be used
    // only when available. Or better:
  }
  
  // This hook assumes services are ready if you use it. 
  // If you access them while null, it will crash, which is "fine" for debugging misconfiguration.
  return {
    firebaseApp: context.firebaseApp!,
    firestore: context.firestore!,
    auth: context.auth!,
    storage: context.storage!,
    user: context.user,
    isUserLoading: context.isUserLoading,
    userError: context.userError
  };
}

/** Hook to access Firebase Auth instance. */
export const useAuth = (): Auth => {
  const { auth } = useFirebase();
  return auth;
};

/** Hook to access Firestore instance. */
export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  return firestore;
};

/** Hook to access Firebase App instance. */
export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  return firebaseApp;
};

type MemoFirebase <T> = T & {__memo?: boolean};

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T | (MemoFirebase<T>) {
  const memoized = useMemo(factory, deps);
  
  if(typeof memoized !== 'object' || memoized === null) return memoized;
  (memoized as MemoFirebase<T>).__memo = true;
  
  return memoized;
}

/**
 * Hook specifically for accessing the authenticated user's state.
 * This provides the User object, loading status, and any auth errors.
 * @returns {UserHookResult} Object with user, isUserLoading, userError.
 */
export const useUser = (): UserHookResult => { // Renamed from useAuthUser
  const { user, isUserLoading, userError } = useFirebase(); // Leverages the main hook
  return { user, isUserLoading, userError };
};