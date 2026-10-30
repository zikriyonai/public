/* Firebase Cloud Messaging service worker (push notifications). Loaded only if you enable FCM. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyDgw9dU2t4tU6PJurnbd6QhtDavh9ZtuMQ',
  authDomain: 'zikriyon-ai.firebaseapp.com',
  projectId: 'zikriyon-ai',
  storageBucket: 'zikriyon-ai.firebasestorage.app',
  messagingSenderId: '918029074446',
  appId: '1:918029074446:web:eb752a982444456eb87c5f',
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((p) => {
  const n = p.notification || {};
  self.registration.showNotification(n.title || 'Zikriyon AI', { body: n.body || '', icon: '/zikriyon.png' });
});
