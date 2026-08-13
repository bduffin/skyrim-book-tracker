import Link from 'next/link';

export default async function AuthErrorPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string; error_description?: string }>;
}) {
    const { error, error_description: errorDescription } = await searchParams;

    return (
        <main>
            <h1>Sign-in failed</h1>
            <p>
                {errorDescription ??
                    error ??
                    'Something went wrong while signing you in. Please try again.'}
            </p>
            <Link href="/">Back to home</Link>
        </main>
    );
}
