import type { SongResult } from '../../../types';
import { getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { toSafeRemoteUrl } from '../../../utils/appPlaybackHelpers';

// src/components/app/playback/createCoverUrlResolver.ts

// Resolves the effective cover URL while avoiding stale per-track artwork for Jellyfin songs.
export const createCoverUrlResolver = (
    cachedCoverUrl: string | null,
    currentSong: SongResult | null,
) => {
    return () => {
        const source = currentSong ? getPlaybackSourceRef(currentSong) : null;
        const url = toSafeRemoteUrl(getSongCoverUrl(currentSong) || null) || null;
        if (source?.kind === 'online' && source.providerId === 'jellyfin') return url;
        if (cachedCoverUrl) return cachedCoverUrl;
        return url;
    };
};
