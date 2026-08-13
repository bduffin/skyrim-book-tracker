import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    // With Fluid compute, don't put this client in a global environment
    // variable. Always create a new one on each request.
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet, headers) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value),
                    );
                    supabaseResponse = NextResponse.next({ request });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options),
                    );
                    // Auth cookies must never be cached by a CDN/ISR, or one
                    // user's session could be served to another. These
                    // headers enforce that.
                    Object.entries(headers).forEach(([key, value]) =>
                        supabaseResponse.headers.set(key, value),
                    );
                },
            },
        },
    );

    // Do not run code between createServerClient and supabase.auth.getClaims().
    // A simple mistake could make it very hard to debug issues with users
    // being randomly logged out.
    //
    // getClaims() verifies the JWT signature locally against the project's
    // published keys, so it's safe to trust for authorization decisions
    // without a network round trip. Do not use getSession() here — it isn't
    // guaranteed to revalidate the token.
    //
    // IMPORTANT: If you remove getClaims() and you use server-side rendering
    // with the Supabase client, your users may be randomly logged out.
    await supabase.auth.getClaims();

    // IMPORTANT: You *must* return the supabaseResponse object as it is. If
    // you're creating a new response object with NextResponse.next() make
    // sure to:
    // 1. Pass the request in it, like so:
    //    const myNewResponse = NextResponse.next({ request })
    // 2. Copy over the cookies, like so:
    //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
    // 3. Change the myNewResponse object to fit your needs, but avoid
    //    changing the cookies!
    // 4. Finally:
    //    return myNewResponse
    // If this is not done, you may be causing the browser and server to go
    // out of sync and terminate the user's session prematurely!
    return supabaseResponse;
}
