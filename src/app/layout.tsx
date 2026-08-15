import React from 'react';
import './globals.css';
import { SiteHeader } from '@/components/site-header';

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>
                <SiteHeader />
                {children}
            </body>
        </html>
    );
}
