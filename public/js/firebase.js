// public/js/firebase.js
// Firebase Authentication Client for FinPilot
// Connects to project: studio-6819802719-f5424

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyA_f_KBgqHT9bMsfNwdv34-68TjhTOasb4",
  authDomain: "studio-6819802719-f5424.firebaseapp.com",
  projectId: "studio-6819802719-f5424",
  storageBucket: "studio-6819802719-f5424.firebasestorage.app",
  messagingSenderId: "849309885170",
  appId: "1:849309885170:web:9433fa0a5834e99ba1a66b"
};

let app = null;
let auth = null;
let googleProvider = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
} catch (e) {
  console.warn('[Firebase] Init warning:', e);
}

export { app, auth };

/**
 * Sign in with Google Popup (1-Click Google Sign-in)
 */
export async function firebaseSignInWithGoogle() {
  if (!auth) throw new Error('Firebase Auth not initialized.');
  const result = await signInWithPopup(auth, googleProvider);
  const token = await result.user.getIdToken();
  return {
    user: result.user,
    token
  };
}

/**
 * Register new user with Email and Password
 */
export async function firebaseSignUpWithEmail(email, password) {
  if (!auth) throw new Error('Firebase Auth not initialized.');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const token = await cred.user.getIdToken();
  return {
    user: cred.user,
    token
  };
}

/**
 * Sign in existing user with Email and Password
 */
export async function firebaseSignInWithEmail(email, password) {
  if (!auth) throw new Error('Firebase Auth not initialized.');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const token = await cred.user.getIdToken();
  return {
    user: cred.user,
    token
  };
}

/**
 * Sign out current user
 */
export async function firebaseSignOut() {
  if (auth) {
    await signOut(auth);
  }
}

/**
 * Wait for Firebase Auth to finish initial state resolution
 */
export async function waitForFirebaseAuth() {
  if (!auth) return null;
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
    return auth.currentUser;
  }
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/**
 * Listen for Firebase Auth state changes
 */
export function onFirebaseAuthStateChange(callback) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}
