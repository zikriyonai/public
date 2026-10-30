/**
 * Public (browser-safe) configuration.
 * Firebase web config is NOT a secret (it only identifies the project); security comes from Firestore rules.
 */
export const CONFIG = {
  company: 'Zikr-E-Ameen Innovations Programming Corporation',
  founder: 'Arman Ansari',
  supportEmail: 'support@zeaipc.in', // PLACEHOLDER — put your real support address
  salesEmail: 'sales@zeaipc.in', // PLACEHOLDER
  gstin: '', // your GSTIN (printed on invoices)

  /** model server */
  api: (process.env.NEXT_PUBLIC_ZIK_API || 'https://api.zikriyonai.linkpc.net').replace(/\/+$/, ''),
  apiKey: process.env.NEXT_PUBLIC_ZIK_API_KEY || '',
  chatMode: (process.env.NEXT_PUBLIC_CHAT_MODE === 'proxy' ? 'proxy' : 'direct') as 'direct' | 'proxy',

  /** Dev-only: click through purchases with test credits, no money. Always off in production builds. */
  sandbox: process.env.NEXT_PUBLIC_PAYMENT_SANDBOX === 'true' && process.env.NODE_ENV !== 'production',

  /** Sync wallet to Firestore users/{uid}/billing/state when signed in */
  syncWallet: true,

  /** Optional developer-API key service (not part of this repo yet) */
  apiKeyEndpoint: process.env.NEXT_PUBLIC_API_KEY_ENDPOINT || null,

  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDgw9dU2t4tU6PJurnbd6QhtDavh9ZtuMQ',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'zikriyon-ai.firebaseapp.com',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'zikriyon-ai',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'zikriyon-ai.firebasestorage.app',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '918029074446',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:918029074446:web:eb752a982444456eb87c5f',
  },
} as const;
