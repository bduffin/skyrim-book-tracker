import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PageTitle } from '@/components/page-title';

export const metadata: Metadata = {
    title: 'Privacy',
};

/**
 * Set by hand whenever the notice's content changes, never computed: a build
 * date would claim changes that did not happen (Privacy FR-1).
 */
const LAST_UPDATED = { iso: '2026-10-20', display: 'October 20, 2026' };

const CONTACT = 'privacy@arcanaeum.app';

const LINK =
    'underline underline-offset-2 transition-colors hover:text-iron-600';

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-3">
            <h2 className="font-serif text-xl">{title}</h2>
            {children}
        </section>
    );
}

function Contact() {
    return (
        <a href={`mailto:${CONTACT}`} className={LINK}>
            {CONTACT}
        </a>
    );
}

/**
 * The privacy notice (Privacy FR-1, FR-2). Every claim here was checked
 * against the hosted project on the date above; anything that changes what is
 * collected, who handles it, what is public or which cookies are set updates
 * this page and LAST_UPDATED in the same change (Privacy FR-5).
 *
 * Rendered per request like every page under the root layout, whose header
 * reads the session, so no `dynamic`, `revalidate` or `'use cache'` here: a
 * cached copy would serve one reader's header to the next.
 */
export default function PrivacyPage() {
    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Privacy</PageTitle>

            <div className="space-y-8 px-4 leading-relaxed">
                <div className="space-y-3">
                    <p>
                        Arcanaeum tracks which of Skyrim&apos;s books you have
                        read and collected. This page says what it stores about
                        you, why, where, and for how long, and how to get a copy
                        of it or have it deleted.
                    </p>
                    <p className="text-sm text-iron-600">
                        Last updated{' '}
                        <time dateTime={LAST_UPDATED.iso}>
                            {LAST_UPDATED.display}
                        </time>
                    </p>
                </div>

                <Section title="Who runs this site">
                    <p>
                        Arcanaeum is an unofficial fan project run by{' '}
                        <a href="https://github.com/bduffin" className={LINK}>
                            bduffin
                        </a>
                        . For requests regarding your data, email <Contact />.
                    </p>
                </Section>

                <Section title="What is collected">
                    <p>
                        Browsing without signing in stores nothing about you in
                        the site&apos;s database. When you sign in with GitHub,
                        it stores:
                    </p>
                    <ul className="list-disc space-y-2 pl-6">
                        <li>
                            From your GitHub account: your email address, name,
                            username, profile picture address and GitHub account
                            number, and whether GitHub reports your email
                            address as verified.
                        </li>
                        <li>
                            When your account was created, and when you last
                            signed in.
                        </li>
                        <li>
                            For each device you are signed in on, when it signed
                            in and when it was last used. The network address
                            and software name recorded with it are the
                            site&apos;s own server&apos;s, not your
                            device&apos;s, because the server is what signs you
                            in and keeps you signed in.
                        </li>
                        <li>
                            A short-lived record of each sign-in while it
                            completes, which can hold the access GitHub grants
                            the site to sign you in. It is deleted within two
                            days.
                        </li>
                        <li>The books you mark as read or collected.</li>
                        <li>
                            Your choice of whether your collection is public or
                            private, once you make it.
                        </li>
                    </ul>
                </Section>

                <Section title="What is not collected">
                    <p>
                        No analytics, advertising or tracking of any kind, and
                        no payment details. Nothing is sold, rented or shared
                        for marketing.
                    </p>
                </Section>

                <Section title="Why">
                    <p>
                        To sign you in and to keep what you save about the
                        books. Nothing else.
                    </p>
                </Section>

                <Section title="Who handles it, and where">
                    <ul className="list-disc space-y-2 pl-6">
                        <li>
                            <strong>Supabase</strong> runs the database and
                            sign-in, in the United States, which is where your
                            data is stored.
                        </li>
                        <li>
                            <strong>Vercel</strong> hosts the site, in the
                            United States and across its global network.
                        </li>
                        <li>
                            <strong>GitHub</strong> is how you sign in.
                        </li>
                        <li>
                            <strong>Cloudflare</strong> runs the site&apos;s
                            domain and forwards email sent to its addresses.
                        </li>
                        <li>
                            <strong>Google</strong>&apos;s Gmail holds email
                            about requests, in two mailboxes: the project&apos;s
                            own, and the developer&apos;s personal inbox, which
                            receives a forwarded copy of every message sent to
                            the site.
                        </li>
                    </ul>
                </Section>

                <Section title="Cookies">
                    <p>
                        Only the ones signing in needs: session cookies that
                        keep you signed in, and a short-lived cookie used during
                        sign-in itself.
                    </p>
                </Section>

                <Section title="How long it is kept">
                    <ul className="list-disc space-y-2 pl-6">
                        <li>
                            Your account and everything you have saved: until
                            you ask for it to be deleted, when it is removed
                            from the database straight away.
                        </li>
                        <li>
                            Each signed-in device&apos;s record: until you sign
                            out on that device, or until it has gone about 90
                            days unused, when it is deleted and that device is
                            signed out.
                        </li>
                        <li>Sign-in records: at most two days.</li>
                        <li>
                            Request logs, which can include your IP address: up
                            to 1 day at Supabase and 1 hour at Vercel. They
                            expire on their own rather than being deleted with
                            your account.
                        </li>
                        <li>Backups: there are none.</li>
                        <li>
                            Email about a request: kept for 12 months after the
                            request is answered, in the project&apos;s mailbox,
                            as the record that it was handled. The forwarded
                            copy in the developer&apos;s personal inbox is
                            deleted when the request is answered. Deleted mail
                            stays in Gmail&apos;s trash for 30 days before Gmail
                            removes it.
                        </li>
                    </ul>
                </Section>

                <Section title="What is public">
                    <p>
                        When you first sign in, you are asked whether your
                        collection should be public or private. Public is
                        selected to start with, and you can change your choice
                        at any time in Settings, in the menu under your name at
                        the top of the page. Until you choose, your account is
                        treated as private.
                    </p>
                    <ul className="list-disc space-y-2 pl-6">
                        <li>
                            <strong>Private:</strong> nothing. No one else can
                            see your collection, or even that your account
                            exists.
                        </li>
                        <li>
                            <strong>Public:</strong> anyone can see that your
                            account exists and that it is public, identified by
                            a random number the site gives your account, not by
                            anything from GitHub, along with its username if it
                            has one. Anyone can also list the public accounts.
                        </li>
                    </ul>
                    <p>
                        Either way, your collection itself is visible only to
                        you for now. Public collections are planned, and this
                        notice will say what they show before they appear.
                    </p>
                </Section>

                <Section title="Your choices">
                    <ul className="list-disc space-y-2 pl-6">
                        <li>
                            Ask for a copy of your data, or for its deletion, by
                            emailing <Contact />. The reply goes to the email
                            address on your GitHub account, to confirm the
                            request came from you before anything is done, and
                            the request is answered within one month.
                        </li>
                        <li>
                            Make your collection public or private at any time,
                            in Settings.
                        </li>
                        <li>Sign out at any time.</li>
                        <li>
                            Revoke the site&apos;s access to your GitHub
                            account, in GitHub&apos;s settings under
                            Applications, then Authorized OAuth Apps.
                        </li>
                    </ul>
                </Section>

                <Section title="Changes">
                    <p>
                        This notice is updated before any change to what is
                        collected or made public, and the date at the top says
                        when it last changed.
                    </p>
                </Section>
            </div>
        </main>
    );
}
