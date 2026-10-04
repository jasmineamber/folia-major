import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JellyfinItemRecord } from '@/services/onlineMusic/jellyfinTransport';

// test/unit/onlineMusic/jellyfinProvider.test.ts

const transport = vi.hoisted(() => ({
    getConnection: vi.fn(() => ({ serverUrl: 'http://server', username: 'user', userId: 'user-1', selectedLibraryIds: ['music-a', 'music-b'] })),
    getSelectedLibraryIds: vi.fn(() => ['music-a', 'music-b']),
    getItems: vi.fn(),
    getImageUrl: vi.fn(() => 'http://server/image'),
    getPlaybackInfo: vi.fn(async () => ({
        PlaySessionId: 'session-1',
        MediaSources: [{ Id: 'media-source-1', SupportsDirectPlay: true }],
    })),
    getPlaybackUrl: vi.fn(() => ({ url: 'http://server/audio?api_key=secret', mediaSourceId: 'media-source-1', playSessionId: 'session-1', playMethod: 'DirectPlay' as const })),
    setFavorite: vi.fn(async () => {}),
    mutatePlaylistTracks: vi.fn(async () => {}),
    getPlaybackIdentity: vi.fn(() => ({ userId: 'user-1', deviceId: 'device-1' })),
    reportPlayback: vi.fn(async () => {}),
}));

vi.mock('@/services/onlineMusic/jellyfinTransport', () => ({
    jellyfinTransport: transport,
    subscribeJellyfinConnection: () => () => {},
}));

import { jellyfinProvider } from '@/services/onlineMusic/jellyfinProvider';

afterEach(() => vi.clearAllMocks());

describe('jellyfinProvider', () => {
    it('merges selected libraries, deduplicates by Jellyfin ID, and pages the combined ordering', async () => {
        transport.getItems.mockImplementation(async (query: Record<string, unknown>) => {
            const items: JellyfinItemRecord[] = query.ParentId === 'music-a'
                ? [{ Id: 'same', Name: 'Alpha' }, { Id: 'a2', Name: 'Charlie' }]
                : [{ Id: 'same', Name: 'Alpha' }, { Id: 'b2', Name: 'Bravo' }];
            return { Items: items, TotalRecordCount: items.length };
        });

        const result = await jellyfinProvider.search!.searchSongs('song', 2, 0);

        expect(transport.getItems).toHaveBeenCalledTimes(2);
        expect(result.items.map(song => song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : '')).toEqual(['same', 'b2']);
        expect(result.items.every(song => song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'jellyfin')).toBe(true);
        expect(result.total).toBe(3);
        expect(result.hasMore).toBe(true);
    });

    it('does not query libraries when none is selected', async () => {
        transport.getSelectedLibraryIds.mockReturnValueOnce([]);

        await expect(jellyfinProvider.search!.searchSongs('song', 20, 0)).resolves.toMatchObject({ items: [], hasMore: false });
        expect(transport.getItems).not.toHaveBeenCalled();
    });

    it('routes favorite changes using the Jellyfin item ID', async () => {
        const song = jellyfinProvider.normalizeSong({ Id: 'track-4', Name: 'Track' });

        await jellyfinProvider.mutations!.likeSong!(song, true);

        expect(transport.setFavorite).toHaveBeenCalledWith('track-4', true);
    });

    it('uses playlist entry identity for removal and rejects playlists without edit permission', async () => {
        const song = jellyfinProvider.normalizeSong({
            Id: 'track-4', Name: 'Track', PlaylistItemId: 'entry-9',
        });
        const editablePlaylist = {
            providerId: 'jellyfin', id: 'playlist-1', name: 'Mine', type: 'playlist', isOwned: true,
            providerData: { canEditItems: true },
        } as const;

        await jellyfinProvider.mutations!.updatePlaylistTracks!('del', editablePlaylist, [song]);
        expect(transport.mutatePlaylistTracks).toHaveBeenCalledWith('playlist-1', 'del', ['entry-9']);

        await expect(jellyfinProvider.mutations!.updatePlaylistTracks!('del', {
            ...editablePlaylist, isOwned: false,
        }, [song])).rejects.toThrow('cannot be edited');
    });

    it('reports playback using session metadata without forwarding the tokenized audio URL', async () => {
        const song = jellyfinProvider.normalizeSong({ Id: 'track-4', Name: 'Track' });
        await jellyfinProvider.playback!.getAudioSource!(song, 'standard');

        await jellyfinProvider.jellyfin!.reportPlaybackEvent(song, { kind: 'start', positionSeconds: 3 });

        expect(transport.reportPlayback).toHaveBeenCalledWith('Sessions/Playing', expect.objectContaining({
            ItemId: 'track-4', UserId: 'user-1', MediaSourceId: 'media-source-1',
            PlaySessionId: 'session-1', PlayMethod: 'DirectPlay', PositionTicks: 30_000_000,
        }));
        expect(JSON.stringify(transport.reportPlayback.mock.calls)).not.toContain('api_key');
        expect(JSON.stringify(transport.reportPlayback.mock.calls)).not.toContain('secret');
    });
});
