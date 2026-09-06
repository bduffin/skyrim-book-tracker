import { createClient } from '@/lib/supabase/server';

export default async function Page() {
    const supabase = await createClient();
    const { data: instruments, error } = await supabase
        .from('instruments')
        .select();

    if (error) {
        console.error('Failed to load instruments:', error);
        throw new Error(error.message);
    }

    return (
        <main>
            <h1>Hello, Next.js!</h1>
            <ul>
                {(instruments ?? []).map((instrument) => (
                    <li key={instrument.id}>{instrument.name}</li>
                ))}
            </ul>
        </main>
    );
}
