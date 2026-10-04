import { describe, expect, it } from 'vitest';
import { normalizeJellyfinCollection, normalizeJellyfinLyrics, normalizeJellyfinSong } from '@/services/onlineMusic/jellyfinNormalize';

// test/unit/onlineMusic/jellyfinNormalize.test.ts

describe('Jellyfin normalization', () => {
    it('preserves Jellyfin identity for songs and related catalog references', () => {
        const song = normalizeJellyfinSong({
            Id: 'track-1',
            Name: 'Track',
            AlbumId: 'album-1',
            Album: 'Album',
            ArtistItems: [{ Id: 'artist-1', Name: 'Artist' }],
            RunTimeTicks: 125_000_000,
        });

        expect(song.sourceRef).toMatchObject({ kind: 'online', providerId: 'jellyfin', mediaId: 'track-1' });
        expect(song.album.catalogRef).toMatchObject({ providerId: 'jellyfin', id: 'album-1' });
        expect(song.artists[0].catalogRef).toMatchObject({ providerId: 'jellyfin', id: 'artist-1' });
        expect(song.durationMs).toBe(12_500);
    });

    it('keeps playlist edit and delete permissions from the server response', () => {
        const playlist = normalizeJellyfinCollection({
            Id: 'playlist-1', Name: 'Mine', OwnerUserId: 'user-1', CanEditItems: true, CanDelete: true,
        }, 'playlist');

        expect(playlist).toMatchObject({
            providerId: 'jellyfin',
            id: 'playlist-1',
            providerData: { ownerUserId: 'user-1', canEditItems: true, canDelete: true },
        });
    });

    it('normalizes structured Jellyfin lyrics and retains empty lyric responses', () => {
        expect(normalizeJellyfinLyrics({ Lyrics: [{ Start: 15_000_000, Text: 'Line' }] }).mainText).toBe('[00:01.50]Line');
        expect(normalizeJellyfinLyrics({ Lyrics: [] })).toMatchObject({ lyrics: null, mainText: null, isPureMusic: true });
    });
});
