import type { Metadata } from 'next';
import React from 'react';
import './globals.css';
import { fontVariables } from './fonts';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ToastProvider } from '@/components/toast';

const NAME = 'Arcanaeum';
const FULL_NAME = 'Arcanaeum: Skyrim Book Tracker';
const DESCRIPTION =
    "Track which of Skyrim's books you've read and collected, with filters for skill books, DLC and more. Unofficial and fan-made.";

/**
 * Site-wide defaults. Pages set only their own short title, which the
 * template suffixes with the name ("Books · Arcanaeum"); the full name, with
 * what the site is, goes where there is room for it.
 *
 * Link previews carry the site's title, description and image on every page,
 * collection pages included, and pages do not override them -- so a shared
 * collection link previews as the site and shows nothing from the collection
 * (FR-10). The image is `opengraph-image.png` beside this file, which Next
 * picks up by name; metadataBase is what makes its URL absolute.
 */
export const metadata: Metadata = {
    metadataBase: new URL('https://arcanaeum.app'),
    title: { default: FULL_NAME, template: `%s · ${NAME}` },
    description: DESCRIPTION,
    applicationName: NAME,
    openGraph: {
        type: 'website',
        siteName: NAME,
        title: FULL_NAME,
        description: DESCRIPTION,
    },
    twitter: { card: 'summary_large_image' },
};

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
                    <SiteFooter />
                </ToastProvider>
            </body>
        </html>
    );
}
