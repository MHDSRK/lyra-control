import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Lyra Control',
  description: 'Private call monitoring dashboard for Lyra',
  applicationName: 'Lyra Control',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Lyra Control' },
  icons: { apple: '/icon.svg', icon: '/icon.svg' }
};
export const viewport: Viewport = { themeColor: '#0b1220', width: 'device-width', initialScale: 1, maximumScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
