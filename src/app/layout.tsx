import React from 'react';
import './globals.css';
import { fontVariables } from './fonts';
import { SiteHeader } from '@/components/site-header';
import { ToastProvider } from '@/components/toast';
import { UespAttribution } from '@/components/uesp-attribution';

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className={fontVariables}>
            <body>
                {/*
                 * Around the whole body so any page's toggles can raise a
                 * toast, and so its live region is in the page from first
                 * render rather than appearing with the first message.
                 */}
                <ToastProvider>
                    <SiteHeader />
                    {children}
                    <UespAttribution />
                </ToastProvider>
            </body>
        </html>
    );
}
