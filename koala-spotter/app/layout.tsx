import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import ServiceWorker from "@/components/ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maggie Koala Spotter",
  description: "Fresh koala sightings on Magnetic Island, reported by visitors, with photos.",
  applicationName: "Maggie Koala Spotter",
  appleWebApp: { capable: true, title: "Koala Spotter", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b5d33",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <ServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
