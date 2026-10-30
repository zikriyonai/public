import type { Metadata, Viewport } from 'next';
import './globals.css';
import './features.css';

export const metadata: Metadata = {
  title: 'Zikriyon AI — The Element of Intelligence',
  description: 'Zikriyon is an AI-powered intelligence platform offering modern tools, automation, and smart digital solutions.',
  authors: [{ name: 'Zikriyon AI by ZEAIPC' }],
  manifest: '/manifest.json',
  icons: { icon: '/favicon.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Zikriyon AI', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#080BFF',
};

/** Runs before paint: restores the saved theme so there is no light→dark flash. */
const THEME_BOOT = `try{var t=localStorage.getItem('zikriyon-theme');if(t==='dark'||t==='blue'){document.body.setAttribute('data-theme',t)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body data-theme="light" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}
      </body>
    </html>
  );
}
