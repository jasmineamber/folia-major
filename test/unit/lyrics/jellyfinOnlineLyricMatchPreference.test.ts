import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { shouldSkipJellyfinOnlineLyricMatch } from '@/utils/onlineLyricsState';

// test/unit/lyrics/jellyfinOnlineLyricMatchPreference.test.ts

describe('shouldSkipJellyfinOnlineLyricMatch', () => {
    const jellyfinSong = {
        sourceRef: { kind: 'online', providerId: 'jellyfin', mediaId: 'track-1' },
    } as SongResult;

    it('honors a saved skip preference for Jellyfin tracks', () => {
        expect(shouldSkipJellyfinOnlineLyricMatch(jellyfinSong, {
            lyricsSource: 'online',
            jellyfinSkipOnlineMatch: true,
        })).toBe(true);
    });

    it('does not apply the preference to other providers or unset state', () => {
        expect(shouldSkipJellyfinOnlineLyricMatch(jellyfinSong, null)).toBe(false);
        expect(shouldSkipJellyfinOnlineLyricMatch({
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'track-1' },
        } as SongResult, {
            lyricsSource: 'online',
            jellyfinSkipOnlineMatch: true,
        })).toBe(false);
    });
});
