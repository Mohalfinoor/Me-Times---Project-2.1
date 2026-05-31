import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, onSnapshot, addDoc, serverTimestamp, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firebase connection successful');
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    } else {
      console.error("Firebase connection test failed:", error);
    }
  }
}

let isLoginInProgress = false;

export async function signInWithGoogle() {
  if (isLoginInProgress) return;
  isLoginInProgress = true;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Create/update user profile
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    return user;
  } catch (error: any) {
    // Silence these specific user-action related errors or multiple-click errors
    if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
      console.warn('Login popup closed or cancelled by user');
      return null;
    }
    if (error.code === 'auth/popup-blocked') {
      alert("Popup Masuk diblokir. Harap izinkan popup untuk situs ini di pengaturan browser Anda dan coba lagi.");
      console.warn('Login popup blocked by browser');
      return null;
    }
    console.error('Login error:', error);
    throw error;
  } finally {
    isLoginInProgress = false;
  }
}

export function logOut() {
  return signOut(auth);
}

// Error handling helper as requested in instructions
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  
  try {
    const safeInfo = JSON.stringify(errInfo);
    console.error('Firestore Error: ', safeInfo);
    throw new Error(safeInfo);
  } catch (stringifyError) {
    // If stringify fails, at least log the basic string representation
    const fallbackMessage = `Firestore Error in ${operationType} on ${path}: ${errInfo.error}`;
    console.error(fallbackMessage);
    throw new Error(fallbackMessage);
  }
}
