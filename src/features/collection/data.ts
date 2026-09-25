import 'server-only';

import { createClient } from '@/lib/supabase/server';

import {
    flagCountQuery,
    totalCountQuery,
    type ProgressSummary,
} from './progress';

/**
 * A user's progress summary (FR-5), from the database on every render --
 * never from anything a client has cached -- so it reflects true state after
 * any change (NFR-6).
 *
 * Three head requests in parallel rather than one: each is a count PostgREST
 * can answer directly, and none waits on another.
 */
export async function getProgress(userId: string): Promise<ProgressSummary> {
    // Per-request, never module scope: a cached client can leak one user's
    // session into another request under Vercel's Fluid compute.
    const supabase = await createClient();

    const [total, collected, read] = await Promise.all([
        totalCountQuery(supabase),
        flagCountQuery(supabase, userId, 'collected'),
        flagCountQuery(supabase, userId, 'read'),
    ]);

    for (const { error } of [total, collected, read]) {
        if (error) {
            console.error('Failed to count progress:', error);
            throw new Error(error.message);
        }
    }

    return {
        total: total.count ?? 0,
        collected: collected.count ?? 0,
        read: read.count ?? 0,
    };
}
