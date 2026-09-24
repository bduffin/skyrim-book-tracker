import React from 'react';
import { EB_Garamond, Jost } from 'next/font/google';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { UespAttribution } from '@/components/uesp-attribution';

// Self-hosted by next/font at build time: no request reaches Google from a
// reader's browser, and the fallback metrics are adjusted so the swap causes
// no layout shift. Both are variable fonts, so one file per family covers
// every weight the theme uses.
const jost = Jost({ subsets: ['latin'], variable: '--font-jost' });
const garamond = EB_Garamond({
    subsets: ['latin'],
    variable: '--font-eb-garamond',
});

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className={`${jost.variable} ${garamond.variable}`}>
            <body>
                <SiteHeader />
                {children}
                <UespAttribution />
            </body>
        </html>
    );
}
