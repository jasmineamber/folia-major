import type { SongResult, UnifiedSong } from '../../types';
import type {
    JellyfinHomeOverview,
    JellyfinPlaybackEvent,
    OnlineMusicProvider,
    ProviderAudioSource,
    ProviderCollection,
    ProviderPage,
    ProviderUser,
} from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import {
    jellyfinSongId,
    normalizeJellyfinCollection,
    normalizeJellyfinLyrics,
    normalizeJellyfinSong,
} from './jellyfinNormalize';
import { jellyfinTransport, subscribeJellyfinConnection, type JellyfinItemRecord } from './jellyfinTransport';

// src/services/onlineMusic/jellyfinProvider.ts
// Adapts Jellyfin's library and playback APIs to Folia's provider contracts.

const VIRTUAL_COLLECTIONS = {
    recentlyAdded: { id: '__jellyfin_recently_added__', type: 'jellyfin-recently-added', name: 'Recently added' },
    recentlyPlayed: { id: '__jellyfin_recently_played__', type: 'jellyfin-recently-played', name: 'Recently played' },
    favorites: { id: '__jellyfin_favorites__', type: 'jellyfin-favorites', name: 'Favorites' },
    randomMix: { id: '__jellyfin_random_mix__', type: 'jellyfin-random', name: 'Random mix' },
} as const;

const emptyPage = <T>(offset: number): ProviderPage<T> => ({ items: [], hasMore: false, nextOffset: offset });

const readString = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const toUser = (user: { id: string; username: string }): ProviderUser => ({
    id: user.id,
    nickname: user.username,
});

const getSongId = (song: SongResult): string => {
    const id = jellyfinSongId(song);
    if (!id) throw new OnlineProviderError('unsupported', 'Song does not belong to Jellyfin', 'jellyfin');
    return id;
};

const normalizeSong = (item: JellyfinItemRecord): UnifiedSong => normalizeJellyfinSong(item, jellyfinTransport.getImageUrl);

const normalizeCollection = (item: JellyfinItemRecord, type?: string): ProviderCollection => {
    const collection = normalizeJellyfinCollection(item, type || readString(item.Type), jellyfinTransport.getImageUrl);
    const ownerUserId = readString(item.OwnerUserId);
    const connection = jellyfinTransport.getConnection();
    if (ownerUserId) collection.isOwned = Boolean(connection && ownerUserId === connection.userId);
    return collection;
};

const page = <T>(items: T[], total: number | undefined, offset: number, limit: number): ProviderPage<T> => {
    const selected = items.slice(offset, offset + limit);
    const nextOffset = offset + selected.length;
    return { items: selected, ...(total === undefined ? {} : { total }), hasMore: nextOffset < items.length || (total !== undefined && nextOffset < total), nextOffset };
};

const itemName = (item: JellyfinItemRecord): string => readString(item.SortName || item.Name).toLocaleLowerCase();

const sortMergedItems = (items: JellyfinItemRecord[], sortBy: string, sortOrder: string): JellyfinItemRecord[] => {
    const key = sortBy.split(',')[0] || 'SortName';
    const direction = sortOrder.toLowerCase() === 'descending' ? -1 : 1;
    return [...items].sort((left, right) => {
        if (key === 'Random') return 0;
        if (key === 'DateCreated' || key === 'DatePlayed') {
            const comparison = Date.parse(readString(left[key])) - Date.parse(readString(right[key]));
            if (Number.isFinite(comparison) && comparison !== 0) return comparison * direction;
        }
        return itemName(left).localeCompare(itemName(right)) * direction;
    });
};

/** Reads each selected music library, merges duplicate items, and pages the combined result. */
const getLibraryItems = async (
    query: Record<string, string | number | boolean | undefined>,
    limit: number,
    offset: number,
): Promise<ProviderPage<JellyfinItemRecord>> => {
    const libraryIds = jellyfinTransport.getSelectedLibraryIds();
    if (!libraryIds.length) return emptyPage(offset);
    const connection = jellyfinTransport.getConnection();
    if (!connection) throw new OnlineProviderError('auth-required', 'Connect a Jellyfin server first.', 'jellyfin');

    const sortBy = readString(query.SortBy || 'SortName');
    const sortOrder = readString(query.SortOrder || 'Ascending');
    const target = offset + limit + 1;
    let requestedLimit = Math.max(target, 50);
    let requests: Array<Awaited<ReturnType<typeof jellyfinTransport.getItems>>> = [];
    let merged: JellyfinItemRecord[] = [];
    let exhausted = false;

    // Counts from different libraries overlap, so grow each sorted prefix until it contains one
    // more unique item than this page needs or every library has been read completely.
    while (true) {
        requests = await Promise.all(libraryIds.map(libraryId => jellyfinTransport.getItems({
            ...query,
            UserId: connection.userId,
            ParentId: libraryId,
            Recursive: true,
            StartIndex: 0,
            Limit: requestedLimit,
        })));
        const unique = new Map<string, JellyfinItemRecord>();
        for (const response of requests) {
            for (const item of response.Items || []) {
                const id = readString(item.Id);
                if (id) unique.set(id, item);
            }
        }
        merged = sortMergedItems([...unique.values()], sortBy, sortOrder);
        exhausted = requests.every(response => (response.Items || []).length < requestedLimit
            || (response.TotalRecordCount !== undefined && response.TotalRecordCount <= requestedLimit));
        if (merged.length >= target || exhausted) break;
        requestedLimit = Math.max(requestedLimit + 1, requestedLimit * 2);
    }
    const total = exhausted ? merged.length : undefined;
    return page(merged, total, offset, limit);
};

const getAllLibraryCollections = async (
    query: Record<string, string | number | boolean | undefined>,
): Promise<ProviderCollection[]> => {
    const items: ProviderCollection[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    while (hasMore) {
        const result = await getLibraryItems(query, limit, offset);
        items.push(...result.items.map(item => normalizeCollection(item)));
        offset = result.nextOffset;
        hasMore = result.hasMore;
    }
    return items;
};

const getAllPlaylists = async (): Promise<ProviderCollection[]> => {
    const items: ProviderCollection[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    while (hasMore) {
        const result = await getPlaylistPage(limit, offset);
        items.push(...result.items);
        offset = result.nextOffset;
        hasMore = result.hasMore;
    }
    return items;
};

const getLibraryCollection = async (
    query: Record<string, string | number | boolean | undefined>,
    limit = 30,
): Promise<ProviderCollection[]> => {
    const result = await getLibraryItems(query, limit, 0);
    return result.items.map(item => normalizeCollection(item));
};

const createVirtualCollection = (key: keyof typeof VIRTUAL_COLLECTIONS, trackCount?: number): ProviderCollection => ({
    providerId: 'jellyfin',
    ...VIRTUAL_COLLECTIONS[key],
    ...(typeof trackCount === 'number' ? { trackCount } : {}),
    providerData: { virtualKind: key },
});

const resolveVirtualQuery = (collection: ProviderCollection): Record<string, string | number | boolean | undefined> | null => {
    switch (collection.type) {
        case VIRTUAL_COLLECTIONS.recentlyAdded.type:
            return { IncludeItemTypes: 'Audio', SortBy: 'DateCreated', SortOrder: 'Descending' };
        case VIRTUAL_COLLECTIONS.recentlyPlayed.type:
            return { IncludeItemTypes: 'Audio', SortBy: 'DatePlayed', SortOrder: 'Descending', Filters: 'IsPlayed' };
        case VIRTUAL_COLLECTIONS.favorites.type:
            return { IncludeItemTypes: 'Audio', Filters: 'IsFavorite', SortBy: 'SortName' };
        case VIRTUAL_COLLECTIONS.randomMix.type:
            return { IncludeItemTypes: 'Audio', SortBy: 'Random' };
        default:
            return null;
    }
};

const getPlaylistPage = async (limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> => {
    const connection = jellyfinTransport.getConnection();
    if (!connection) throw new OnlineProviderError('auth-required', 'Connect a Jellyfin server first.', 'jellyfin');
    const response = await jellyfinTransport.getItems({
        UserId: connection.userId,
        IncludeItemTypes: 'Playlist',
        Recursive: true,
        SortBy: 'SortName',
        Fields: 'PrimaryImageAspectRatio,UserData,OwnerUserId,CanEditItems,CanDelete',
        StartIndex: offset,
        Limit: limit,
    });
    const items = (response.Items || []).map(item => normalizeCollection(item, 'playlist'));
    const total = response.TotalRecordCount ?? items.length;
    return { items, total, hasMore: offset + items.length < total, nextOffset: offset + items.length };
};

const getHomeOverview = async (): Promise<JellyfinHomeOverview> => {
    if (!jellyfinTransport.getSelectedLibraryIds().length) {
        return {
            albums: [], artists: [], playlists: [],
            recentlyAdded: createVirtualCollection('recentlyAdded', 0),
            recentlyPlayed: createVirtualCollection('recentlyPlayed', 0),
            favorites: createVirtualCollection('favorites', 0),
            randomMix: createVirtualCollection('randomMix'),
        };
    }

    const [albums, artists, added, played, favorites, playlists] = await Promise.all([
        getAllLibraryCollections({ IncludeItemTypes: 'MusicAlbum', SortBy: 'DateCreated', SortOrder: 'Descending' }),
        getAllLibraryCollections({ IncludeItemTypes: 'MusicArtist', SortBy: 'SortName', SortOrder: 'Ascending' }),
        getLibraryItems({ IncludeItemTypes: 'Audio', SortBy: 'DateCreated', SortOrder: 'Descending' }, 1, 0),
        getLibraryItems({ IncludeItemTypes: 'Audio', SortBy: 'DatePlayed', SortOrder: 'Descending', Filters: 'IsPlayed' }, 1, 0),
        getLibraryItems({ IncludeItemTypes: 'Audio', Filters: 'IsFavorite' }, 1, 0),
        getAllPlaylists(),
    ]);
    return {
        albums,
        artists,
        playlists,
        recentlyAdded: createVirtualCollection('recentlyAdded', added.total),
        recentlyPlayed: createVirtualCollection('recentlyPlayed', played.total),
        favorites: createVirtualCollection('favorites', favorites.total),
        randomMix: createVirtualCollection('randomMix'),
    };
};

const getCollectionTracks = async (
    collection: ProviderCollection,
    limit: number,
    offset: number,
): Promise<ProviderPage<UnifiedSong>> => {
    if (collection.providerId !== 'jellyfin') {
        throw new OnlineProviderError('unsupported', 'Collection does not belong to Jellyfin', 'jellyfin');
    }

    const virtualQuery = resolveVirtualQuery(collection);
    if (virtualQuery) {
        const result = await getLibraryItems(virtualQuery, limit, offset);
        return { ...result, items: result.items.map(normalizeSong) };
    }

    if (collection.type === 'playlist') {
        const response = await jellyfinTransport.getPlaylistItems(String(collection.id), { limit, offset });
        const songs = (response.Items || []).map(normalizeSong);
        const total = response.TotalRecordCount;
        return { items: songs, ...(total === undefined ? {} : { total }), hasMore: offset + songs.length < (total ?? offset + songs.length + (songs.length === limit ? 1 : 0)), nextOffset: offset + songs.length };
    }

    if (collection.type === 'album') {
        const connection = jellyfinTransport.getConnection();
        if (!connection) throw new OnlineProviderError('auth-required', 'Connect a Jellyfin server first.', 'jellyfin');
        const response = await jellyfinTransport.getItems({
            UserId: connection.userId,
            ParentId: String(collection.id),
            IncludeItemTypes: 'Audio',
            Recursive: true,
            SortBy: 'ParentIndexNumber,IndexNumber,SortName',
            SortOrder: 'Ascending',
            StartIndex: offset,
            Limit: limit,
        });
        const songs = (response.Items || []).map(normalizeSong);
        const total = response.TotalRecordCount ?? songs.length;
        return { items: songs, total, hasMore: offset + songs.length < total, nextOffset: offset + songs.length };
    }

    if (collection.type === 'artist') {
        const result = await getLibraryItems({
            IncludeItemTypes: 'Audio',
            ArtistIds: String(collection.id),
            SortBy: 'Album,ParentIndexNumber,IndexNumber,SortName',
            SortOrder: 'Ascending',
        }, limit, offset);
        return { ...result, items: result.items.map(normalizeSong) };
    }

    const virtualKind = readString(collection.providerData?.virtualKind);
    if (virtualKind === 'recentlyAdded') return getCollectionTracks({ ...collection, type: VIRTUAL_COLLECTIONS.recentlyAdded.type }, limit, offset);
    if (virtualKind === 'recentlyPlayed') return getCollectionTracks({ ...collection, type: VIRTUAL_COLLECTIONS.recentlyPlayed.type }, limit, offset);
    if (virtualKind === 'favorites') return getCollectionTracks({ ...collection, type: VIRTUAL_COLLECTIONS.favorites.type }, limit, offset);
    if (virtualKind === 'randomMix') return getCollectionTracks({ ...collection, type: VIRTUAL_COLLECTIONS.randomMix.type }, limit, offset);
    throw new OnlineProviderError('unsupported', 'Unsupported Jellyfin collection type: ' + collection.type, 'jellyfin');
};

const resolvedPlayback = new Map<string, { mediaSourceId?: string; playSessionId?: string; playMethod?: JellyfinPlaybackEvent['playMethod'] }>();

export const jellyfinProvider: OnlineMusicProvider = {
    id: 'jellyfin',
    displayName: 'Jellyfin',
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        auth: true,
        userLibrary: true,
        playlists: true,
        albums: true,
        artists: true,
        recommendations: false,
        mutations: true,
        wordByWordLyrics: false,
        playlistTrackMutations: true,
        likes: true,
        playbackReports: false,
    },
    getAvailability: () => ({ configured: Boolean(jellyfinTransport.getConnection()) }),
    normalizeSong,
    normalizeUser: raw => {
        const user = raw as { Id?: unknown; Name?: unknown };
        return { id: readString(user.Id), nickname: readString(user.Name) };
    },
    normalizeCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return emptyPage(offset);
            const result = await getLibraryItems({
                IncludeItemTypes: 'Audio',
                SearchTerm: query.trim(),
                SortBy: 'SortName',
                SortOrder: 'Ascending',
            }, limit, offset);
            return { ...result, items: result.items.map(normalizeSong) };
        },
    },
    playback: {
        async getSongDetail(id) {
            return normalizeSong(await jellyfinTransport.getItem(String(id)));
        },
        async getAudioSource(song): Promise<ProviderAudioSource | null> {
            const id = getSongId(song);
            const info = await jellyfinTransport.getPlaybackInfo(id, {});
            const playback = jellyfinTransport.getPlaybackUrl(id, info);
            resolvedPlayback.set(id, {
                ...(playback.mediaSourceId ? { mediaSourceId: playback.mediaSourceId } : {}),
                ...(playback.playSessionId ? { playSessionId: playback.playSessionId } : {}),
                playMethod: playback.playMethod,
            });
            return { url: playback.url, fetchedAt: Date.now(), quality: 'standard' };
        },
    },
    lyrics: {
        async getLyrics(song) {
            return normalizeJellyfinLyrics(await jellyfinTransport.getLyrics(getSongId(song)));
        },
    },
    auth: {
        async getLoginStatus() {
            const connection = jellyfinTransport.getConnection();
            return connection ? toUser({ id: connection.userId, username: connection.username }) : null;
        },
        async logout() {
            resolvedPlayback.clear();
            jellyfinTransport.logout();
        },
    },
    library: {
        getUserPlaylists: getPlaylistPage,
        async getLikedSongIds() {
            const result = await getLibraryItems({ IncludeItemTypes: 'Audio', Filters: 'IsFavorite' }, 10_000, 0);
            return result.items.map(item => readString(item.Id)).filter(Boolean);
        },
        async getLikedSongs() {
            const result = await getLibraryItems({ IncludeItemTypes: 'Audio', Filters: 'IsFavorite' }, 10_000, 0);
            return result.items.map(normalizeSong);
        },
    },
    catalog: {
        getPlaylistTracks: (id, limit, offset) => getCollectionTracks({ providerId: 'jellyfin', id, name: '', type: 'playlist' }, limit, offset),
        getAlbumTracks: (id, limit = 30, offset = 0) => getCollectionTracks({ providerId: 'jellyfin', id, name: '', type: 'album' }, limit, offset),
        getArtistSongs: (id, limit, offset) => getCollectionTracks({ providerId: 'jellyfin', id, name: '', type: 'artist' }, limit, offset),
    },
    mutations: {
        async likeSong(song, liked) {
            await jellyfinTransport.setFavorite(typeof song === 'object' ? getSongId(song) : String(song), liked);
        },
        async updatePlaylistTracks(operation, playlist, tracks) {
            if (typeof playlist === 'object' && (playlist.providerData?.canEditItems !== true || playlist.isOwned !== true)) {
                throw new OnlineProviderError('unsupported', 'This Jellyfin playlist cannot be edited by the current user.', 'jellyfin');
            }
            const playlistId = typeof playlist === 'object' ? String(playlist.id) : String(playlist);
            const itemIds = tracks.map(track => {
                if (typeof track !== 'object') return String(track);
                const playlistItemId = track.sourceRef?.kind === 'online'
                    && track.sourceRef.providerId === 'jellyfin'
                    && typeof track.sourceRef.providerData?.playlistItemId === 'string'
                    ? track.sourceRef.providerData.playlistItemId
                    : '';
                return playlistItemId || getSongId(track);
            });
            await jellyfinTransport.mutatePlaylistTracks(playlistId, operation, itemIds);
        },
        canAddToPlaylist: playlist => playlist.providerId === 'jellyfin'
            && playlist.type === 'playlist'
            && playlist.isOwned === true
            && playlist.providerData?.canEditItems === true,
    },
    jellyfin: {
        getConnection: jellyfinTransport.getConnection,
        async login(serverUrl, username, password) {
            const result = await jellyfinTransport.login(serverUrl, username, password);
            resolvedPlayback.clear();
            return result;
        },
        async logout() { jellyfinProvider.auth!.logout(); },
        getLibraries: jellyfinTransport.getLibraries,
        setSelectedLibraries: jellyfinTransport.setSelectedLibraries,
        getHomeOverview,
        async createPlaylist(name, songs = []) {
            const item = await jellyfinTransport.createPlaylist(name, songs.map(song => ({ id: getSongId(song) })));
            return normalizeCollection(item, 'playlist');
        },
        async renamePlaylist(playlist, name) {
            if (playlist.providerId !== 'jellyfin' || playlist.type !== 'playlist' || playlist.isOwned !== true || playlist.providerData?.canEditItems !== true) {
                throw new OnlineProviderError('unsupported', 'This Jellyfin playlist cannot be renamed by the current user.', 'jellyfin');
            }
            await jellyfinTransport.renamePlaylist(String(playlist.id), name);
        },
        async deletePlaylist(playlist) {
            if (playlist.providerId !== 'jellyfin' || playlist.type !== 'playlist' || playlist.isOwned !== true || playlist.providerData?.canDelete !== true) {
                throw new OnlineProviderError('unsupported', 'This Jellyfin playlist cannot be deleted by the current user.', 'jellyfin');
            }
            await jellyfinTransport.deletePlaylist(String(playlist.id));
        },
        searchSongs: (query, limit, offset) => jellyfinProvider.search!.searchSongs(query, limit, offset),
        getCollectionTracks,
        async reportPlaybackEvent(song, event) {
            const itemId = getSongId(song);
            const remembered = resolvedPlayback.get(itemId);
            const identity = jellyfinTransport.getPlaybackIdentity();
            const path = event.kind === 'start'
                ? 'Sessions/Playing'
                : event.kind === 'progress'
                    ? 'Sessions/Playing/Progress'
                    : 'Sessions/Playing/Stopped';
            const body = {
                ItemId: itemId,
                UserId: identity.userId,
                DeviceId: identity.deviceId,
                PlaySessionId: event.playSessionId || remembered?.playSessionId,
                MediaSourceId: event.mediaSourceId || remembered?.mediaSourceId,
                PlayMethod: event.playMethod || remembered?.playMethod,
                PositionTicks: Math.max(0, Math.round(event.positionSeconds * 10_000_000)),
                IsPaused: Boolean(event.isPaused),
                CanSeek: true,
                IsMuted: false,
                PlaybackRate: 1,
            };
            await jellyfinTransport.reportPlayback(path, body);
            if (event.kind === 'stopped') resolvedPlayback.delete(itemId);
        },
        subscribeConnection: subscribeJellyfinConnection,
    },
};
