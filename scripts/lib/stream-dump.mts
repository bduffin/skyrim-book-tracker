/**
 * Streaming reader for a MediaWiki XML dump (FR-2).
 *
 * Decompression is chosen by MAGIC BYTES, not by file extension: the dump we
 * download is `.xml.bz2`, but a failed download can arrive as an HTML error
 * page wearing the same name, and that must fail loudly rather than be parsed
 * as XML.
 *
 * The decompressed stream is never buffered whole (NFR-1) -- pages are emitted
 * one at a time. Callers do buffer the *parsed results*, which is unavoidable:
 * a book's lore page can appear later in the dump than the book itself.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import sax from 'sax';

export type DumpPage = {
    title: string;
    ns: number;
    pageId: number;
    wikitext: string;
};

export type Compression = 'bzip2' | 'gzip' | 'none';

/** How often to report progress; ~235 callbacks over the real dump. */
const PROGRESS_EVERY = 2000;

const MAGIC = {
    bzip2: Buffer.from('BZh'),
    gzip: Buffer.from([0x1f, 0x8b]),
};

/** Sniffs the first bytes to decide how (or whether) to decompress. */
export async function detectCompression(path: string): Promise<Compression> {
    const handle = await open(path, 'r');
    try {
        const { buffer } = await handle.read(Buffer.alloc(3), 0, 3, 0);
        if (buffer.subarray(0, 3).equals(MAGIC.bzip2)) return 'bzip2';
        if (buffer.subarray(0, 2).equals(MAGIC.gzip)) return 'gzip';
        return 'none';
    } finally {
        await handle.close();
    }
}

/**
 * `bzip2 -dc` as a subprocess rather than an npm bz2 library: no new
 * dependency, no multi-GB intermediate file, and bzip2 ships with macOS and
 * every Linux distro. The cost is a system dependency, checked here so the
 * failure is a clear message rather than ENOENT from deep in a pipe.
 */
function bzip2Stream(path: string): Readable {
    const child = spawn('bzip2', ['-dc', path], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
        child.stdout.destroy(
            err.code === 'ENOENT'
                ? new Error(
                      'bzip2 is not on PATH. The UESP dump is bzip2-compressed; ' +
                          'install bzip2 (macOS: preinstalled; Debian/Ubuntu: apt install bzip2).',
                  )
                : err,
        );
    });

    child.on('close', (code) => {
        if (code !== 0 && code !== null) {
            child.stdout.destroy(
                new Error(
                    `bzip2 exited ${code} reading ${path}. ${stderr.trim() || 'The file may be truncated or corrupt.'}`,
                ),
            );
        }
    });

    return child.stdout;
}

async function decompressedStream(path: string): Promise<Readable> {
    await stat(path); // surfaces ENOENT as a clean error before anything else
    const compression = await detectCompression(path);
    switch (compression) {
        case 'bzip2':
            return bzip2Stream(path);
        case 'gzip':
            return createReadStream(path).pipe(createGunzip());
        case 'none':
            return createReadStream(path);
    }
}

/**
 * Emits every `<page>` in the dump. `onPage` may be async; the stream is
 * paused while it settles so a slow consumer cannot outrun the parser.
 */
export async function forEachPage(
    path: string,
    onPage: (page: DumpPage) => void,
    /**
     * Called every `PROGRESS_EVERY` pages. The pass over the real dump takes
     * ~34s and emits nothing until it finishes, which reads as a hang -- most
     * sharply right after the credential prompt, where the user is watching.
     */
    onProgress?: (pagesSeen: number) => void,
): Promise<{ compression: Compression; pagesSeen: number }> {
    const compression = await detectCompression(path);
    const source = await decompressedStream(path);
    const parser = sax.createStream(false, { trim: false, lowercase: true });

    let pagesSeen = 0;

    // Only the first <id> inside a <page> is the page id; <revision> carries
    // its own, and a contributor has a third.
    let depth = { page: false, revision: false };
    let current: Partial<DumpPage> | null = null;
    let capture: 'title' | 'ns' | 'id' | 'text' | null = null;
    let buf = '';

    parser.on('opentag', (tag) => {
        switch (tag.name) {
            case 'page':
                current = {};
                depth = { page: true, revision: false };
                return;
            case 'revision':
                depth.revision = true;
                return;
        }
        if (!depth.page || !current) return;
        if (tag.name === 'title' && current.title === undefined)
            capture = 'title';
        else if (tag.name === 'ns' && current.ns === undefined) capture = 'ns';
        else if (
            tag.name === 'id' &&
            current.pageId === undefined &&
            !depth.revision
        )
            capture = 'id';
        else if (tag.name === 'text' && current.wikitext === undefined)
            capture = 'text';
        if (capture) buf = '';
    });

    // sax splits text across chunk boundaries, so accumulate rather than assign.
    parser.on('text', (t) => {
        if (capture) buf += t;
    });
    parser.on('cdata', (t) => {
        if (capture) buf += t;
    });

    parser.on('closetag', (name) => {
        if (name === 'page') {
            if (
                current &&
                current.title !== undefined &&
                current.ns !== undefined &&
                current.pageId !== undefined
            ) {
                pagesSeen += 1;
                if (onProgress && pagesSeen % PROGRESS_EVERY === 0) {
                    onProgress(pagesSeen);
                }
                onPage({
                    title: current.title,
                    ns: current.ns,
                    pageId: current.pageId,
                    wikitext: current.wikitext ?? '',
                });
            }
            current = null;
            depth = { page: false, revision: false };
            return;
        }
        if (name === 'revision') depth.revision = false;
        if (!capture || !current) return;
        switch (capture) {
            case 'title':
                current.title = buf;
                break;
            case 'ns':
                current.ns = Number(buf);
                break;
            case 'id':
                current.pageId = Number(buf);
                break;
            case 'text':
                current.wikitext = buf;
                break;
        }
        capture = null;
        buf = '';
    });

    await new Promise<void>((resolve, reject) => {
        parser.on('error', (err) => reject(err));
        parser.on('end', () => resolve());
        source.on('error', (err) => reject(err));
        source.pipe(parser);
    });

    if (pagesSeen === 0) {
        throw new Error(
            `No <page> elements found in ${path}. Detected compression: ${compression}. ` +
                'If this is a .bz2 that decompressed to HTML, the download failed and ' +
                'produced an error page rather than a dump.',
        );
    }

    return { compression, pagesSeen };
}
