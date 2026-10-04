import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { createCoverUrlResolver } from '@/components/app/playback/createCoverUrlResolver';

// test/unit/playback/createCoverUrlResolver.test.ts

const makeSong = (providerId: string, coverUrl?: string): SongResult => ({
    id: 'track-1',
    name: 'Track',
    artists: [],
    album: { id: 'album-1', name: 'Album', ...(coverUrl ? { coverUrl } : {}) },
    durationMs: 0,
    sourceRef: { kind: 'online', providerId, mediaId: 'track-1' },
});

describe('playback cover URL resolver', () => {
    it('uses Jellyfin song metadata instead of a stale per-track cached cover', () => {
        const song = makeSong('jellyfin', 'http://jellyfin.local/Items/album-1/Images/Primary');

        expect(createCoverUrlResolver('blob:stale-cover', song)())
            .toBe('http://jellyfin.local/Items/album-1/Images/Primary');
    });

    it('does not fall back to a stale cache when Jellyfin metadata has no cover', () => {
        expect(createCoverUrlResolver('blob:stale-cover', makeSong('jellyfin'))()).toBeNull();
    });

    it('keeps cached cover priority for other online providers', () => {
        const song = makeSong('netease', 'https://example.test/current-cover.jpg');

        expect(createCoverUrlResolver('blob:cached-cover', song)()).toBe('blob:cached-cover');
    });
});
