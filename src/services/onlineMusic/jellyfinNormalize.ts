import type { SongResult, UnifiedSong } from '../../types';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import type { JsonValue, ProviderCollection, ProviderLyricsResult } from '../../types/onlineMusic';

// src/services/onlineMusic/jellyfinNormalize.ts
// Converts Jellyfin DTOs into provider-neutral songs, collections, and lyrics.

type JellyfinRecord = Record<string, unknown>;
type ImageUrlResolver = (itemId: string, imageTag?: string, size?: number) => string;

const asRecord = (value: unknown): JellyfinRecord => (
    value && typeof value === 'object' ? value as JellyfinRecord : {}
);

const asString = (value: unknown): string => typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';

const getImageUrl = (raw: JellyfinRecord, resolver?: ImageUrlResolver): string | undefined => {
    const id = asString(raw.Id);
    const tags = asRecord(raw.ImageTags);
    const tag = asString(raw.PrimaryImageTag || tags.Primary);
    if (!id || !resolver) return undefined;
    try {
        return resolver(id, tag || undefined, 600);
    } catch {
        return undefined;
    }
};

const normalizeArtistItems = (raw: JellyfinRecord): Array<{ id: string; name: string }> => {
    const artistItems = Array.isArray(raw.ArtistItems) ? raw.ArtistItems : [];
    const artists = artistItems.flatMap(item => {
        const artist = asRecord(item);
        const name = asString(artist.Name);
        return name ? [{ id: asString(artist.Id) || name, name }] : [];
    });
    if (artists.length) return artists;
    if (Array.isArray(raw.Artists)) {
        return raw.Artists.flatMap(item => {
            const name = asString(item);
            return name ? [{ id: name, name }] : [];
        });
    }
    const albumArtist = asString(raw.AlbumArtist);
    return albumArtist ? [{ id: albumArtist, name: albumArtist }] : [];
};

/** Maps one Jellyfin Audio item while preserving Jellyfin IDs on every related entity. */
export const normalizeJellyfinSong = (
    value: unknown,
    resolveImageUrl?: ImageUrlResolver,
): UnifiedSong => {
    const raw = asRecord(value);
    const id = asString(raw.Id);
    const name = asString(raw.Name) || 'Unknown track';
    const albumId = asString(raw.AlbumId);
    const albumName = asString(raw.Album) || 'Unknown album';
    const artists = normalizeArtistItems(raw);
    const imageUrl = getImageUrl(raw, resolveImageUrl);
    const albumImageTag = asString(raw.AlbumPrimaryImageTag);
    const albumCover = albumId && resolveImageUrl
        ? (() => {
            try { return resolveImageUrl(albumId, albumImageTag || undefined, 600); } catch { return imageUrl; }
        })()
        : imageUrl;
    const ticks = Number(raw.RunTimeTicks);
    const runtimeMs = Number.isFinite(ticks) && ticks > 0
        ? Math.round(ticks / 10_000)
        : Math.max(0, Number(raw.RunTimeTicksMs) || 0);
    const userData = asRecord(raw.UserData);
    const sourceData: Record<string, JsonValue> = {
        itemType: asString(raw.Type) || 'Audio',
        albumId,
        albumName,
        isFavorite: userData.IsFavorite === true,
        artistIds: Array.isArray(raw.ArtistItems)
            ? raw.ArtistItems.flatMap(item => asString(asRecord(item).Id) || [])
            : [],
    };
    if (asString(raw.ParentId)) sourceData.libraryId = asString(raw.ParentId);
    if (asString(raw.PlaylistItemId)) sourceData.playlistItemId = asString(raw.PlaylistItemId);
    if (Array.isArray(raw.MediaSources) && asString(asRecord(raw.MediaSources[0]).Id)) {
        sourceData.mediaSourceId = asString(asRecord(raw.MediaSources[0]).Id);
    }

    return {
        id,
        name,
        artists: artists.map(artist => ({
            id: artist.id,
            name: artist.name,
            catalogRef: { providerId: 'jellyfin', kind: 'artist', id: artist.id },
        })),
        album: {
            id: albumId,
            name: albumName,
            ...(albumCover ? { coverUrl: albumCover } : {}),
            catalogRef: { providerId: 'jellyfin', kind: 'album', id: albumId },
        },
        durationMs: runtimeMs,
        ...(imageUrl ? { coverUrl: imageUrl } : {}),
        isPureMusic: raw.IsThemeMedia === true,
        sourceRef: {
            kind: 'online',
            providerId: 'jellyfin',
            mediaId: id,
            providerData: sourceData,
        },
    };
};

/** Maps album, artist, and playlist DTOs without discarding their source identity. */
export const normalizeJellyfinCollection = (
    value: unknown,
    type: string,
    resolveImageUrl?: ImageUrlResolver,
): ProviderCollection => {
    const raw = asRecord(value);
    const id = asString(raw.Id);
    const artists = normalizeArtistItems(raw).map(artist => ({
        id: artist.id,
        name: artist.name,
        catalogRef: { providerId: 'jellyfin' as const, kind: 'artist' as const, id: artist.id },
    }));
    const rawType = type || asString(raw.Type);
    const collectionType = rawType === 'MusicAlbum' ? 'album'
        : rawType === 'MusicArtist' ? 'artist'
            : rawType.toLowerCase() === 'playlist' ? 'playlist' : rawType.toLowerCase();
    const imageUrl = getImageUrl(raw, resolveImageUrl);
    const userData = asRecord(raw.UserData);
    const userId = asString(raw.OwnerUserId);
    return {
        providerId: 'jellyfin',
        id,
        name: asString(raw.Name) || 'Untitled',
        type: collectionType,
        ...(imageUrl ? { coverUrl: imageUrl } : {}),
        ...(asString(raw.Overview) ? { description: asString(raw.Overview) } : {}),
        ...(Number.isFinite(Number(raw.ChildCount)) ? { trackCount: Number(raw.ChildCount) } : {}),
        ...(artists.length ? { artists } : {}),
        ...(userId ? { isOwned: true } : {}),
        ...(userData.IsFavorite === true ? { isLiked: true } : {}),
        providerData: {
            itemType: asString(raw.Type) || collectionType,
            ...(userId ? { ownerUserId: userId } : {}),
            ...(raw.CanEditItems === true ? { canEditItems: true } : {}),
            ...(raw.CanDelete === true ? { canDelete: true } : {}),
        },
    };
};

const toLrcTimestamp = (value: unknown): string | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const seconds = value > 10_000 ? value / 10_000_000 : value;
        const minutes = Math.floor(seconds / 60);
        return '[' + String(minutes).padStart(2, '0') + ':' + (seconds % 60).toFixed(2).padStart(5, '0') + ']';
    }
    if (typeof value !== 'string') return null;
    const match = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/);
    if (!match) return null;
    const hours = Number(match[1] || 0);
    const minutes = hours * 60 + Number(match[2]);
    const seconds = Number(match[3]) + Number('0.' + (match[4] || '0'));
    return '[' + String(minutes).padStart(2, '0') + ':' + seconds.toFixed(2).padStart(5, '0') + ']';
};

/** Accepts Jellyfin's structured lyric lines and normalizes them into Folia's LRC parser. */
export const normalizeJellyfinLyrics = (value: unknown): ProviderLyricsResult => {
    const raw = asRecord(value);
    const source = raw.Lyrics ?? raw.lyrics ?? raw;
    let mainText = '';
    if (typeof source === 'string') {
        mainText = source;
    } else if (Array.isArray(source)) {
        mainText = source.flatMap(lineValue => {
            const line = asRecord(lineValue);
            const text = asString(line.Text ?? line.text);
            if (!text) return [];
            const timestamp = toLrcTimestamp(line.Start ?? line.start ?? line.Time ?? line.time);
            return [timestamp ? timestamp + text : text];
        }).join('\n');
    }
    const lyrics = mainText ? parseLyricsByFormat('lrc', mainText) : null;
    return { lyrics, mainText: mainText || null, isPureMusic: !mainText };
};

export const jellyfinSongId = (song: SongResult): string | null => {
    const source = song.sourceRef;
    return source?.kind === 'online' && source.providerId === 'jellyfin' ? source.mediaId : null;
};
