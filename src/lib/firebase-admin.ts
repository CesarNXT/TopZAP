import * as admin from "firebase-admin";

if (!admin.apps.length) {
  // If we have the private key (Service Account), use it
  if (process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    // Fallback: This might fail if no default credentials are set up in the environment
    // But it prevents crashing if the env vars are missing during build/dev
    console.warn("Firebase Admin: Missing Service Account credentials. Server-side operations might fail.");
    // We could initialize with default credentials if running in GCP, but for local, we just skip or init with partial
    // For now, let's not initialize if we don't have keys, or init with applicationDefault()
    // admin.initializeApp(); 
  }
}

let db: admin.firestore.Firestore;
let auth: admin.auth.Auth;

if (admin.apps.length) {
  db = admin.firestore();
  auth = admin.auth();
} else {
  // Create a Proxy that throws an error when any property is accessed
  const createThrowingProxy = (name: string) => new Proxy({}, {
    get: (_target, prop) => {
        // Allow strictly necessary checks like 'then' (for promises) to return undefined if needed, 
        // but mostly we want to fail hard.
        throw new Error(`Firebase Admin (${name}) not initialized. Check server logs for missing credentials.`);
    }
  });

  db = createThrowingProxy('Firestore') as any;
  auth = createThrowingProxy('Auth') as any;
}

export { admin, db, auth };
