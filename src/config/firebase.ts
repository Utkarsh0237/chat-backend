import * as admin from 'firebase-admin';
import path from 'path';
import { config } from './env';

let firestoreInstance: admin.firestore.Firestore | null = null;
let isInitialized = false;

export function initializeFirebase(): admin.firestore.Firestore {
  if (firestoreInstance && isInitialized) {
    return firestoreInstance;
  }

  if (config.firebase.emulatorHost) {
    process.env.FIRESTORE_EMULATOR_HOST = config.firebase.emulatorHost;
  }

  if (admin.apps.length === 0) {
    if (config.firebase.serviceAccountKeyBase64) {
      const decoded = Buffer.from(config.firebase.serviceAccountKeyBase64, 'base64').toString(
        'utf8',
      );
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(decoded)),
        projectId: config.firebase.projectId,
      });
    } else if (config.firebase.serviceAccountKeyPath) {
      const resolvedKeyPath = path.resolve(process.cwd(), config.firebase.serviceAccountKeyPath);
      admin.initializeApp({
        credential: admin.credential.cert(resolvedKeyPath),
        projectId: config.firebase.projectId,
      });
    } else if (config.firebase.emulatorHost) {
      // Firestore Emulator requires only projectId without GCP service account credentials
      admin.initializeApp({
        projectId: config.firebase.projectId,
      });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: config.firebase.projectId,
      });
    }
  }

  firestoreInstance = admin.firestore();
  isInitialized = true;
  return firestoreInstance;
}

export function getFirestore(): admin.firestore.Firestore {
  if (!firestoreInstance) {
    return initializeFirebase();
  }
  return firestoreInstance;
}
