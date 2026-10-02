import type { NextRequest } from 'next/server';
import { contentSecurityPolicy, createNonce, CSP_HEADER } from '@/lib/csp';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
    const policy = contentSecurityPolicy({
        nonce: createNonce(),
        isDev: process.env.NODE_ENV === 'development',
        supabaseOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL
            ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
            : null,
    });

    // On the request, for Next to read the nonce from while rendering and
    // attach it to its scripts. updateSession builds its response from this
    // request's headers (NextResponse.next({ request })), the same way the
    // refreshed session cookies reach the render.
    request.headers.set(CSP_HEADER, policy);
    const response = await updateSession(request);
    // On the response, for the browser to apply.
    response.headers.set(CSP_HEADER, policy);
    return response;
}

export const config = {
    matcher: [
        // Everything except static assets and images.
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
