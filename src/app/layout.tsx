import React from 'react';
import './globals.css';
import { fontVariables } from './fonts';
import { SiteHeader } from '@/components/site-header';
import { UespAttribution } from '@/components/uesp-attribution';

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className={fontVariables}>
            <body>
                <SiteHeader />
                {children}
                <UespAttribution />
            </body>
        </html>
    );
}
