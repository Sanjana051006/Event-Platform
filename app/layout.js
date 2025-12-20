// app/layout.js
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

// 1. Add the Viewport export (Required for PWA in Next.js 14+)
export const viewport = {
  themeColor: "#ffffff", // Should match background_color in your site.webmanifest
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Often used in PWAs to feel native
};

export const metadata = {
  title: "EventX - College Event Platform",
  description: "Join us for amazing hackathons and technical events from all clubs",
  manifest: '/manifest.json', 
  // 2. Add Apple-specific PWA settings here
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EventX",
  },
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico', rel: 'icon' }, 
    ],
    apple: [
      { url: '/apple-touch-icon.png' }, 
    ],
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <AuthProvider>
          {children}
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </body>
    </html>
  );
}