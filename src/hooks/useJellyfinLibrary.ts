import { useCallback, useEffect } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';

// src/hooks/useJellyfinLibrary.ts
// Hydrates the Jellyfin provider account snapshot and keeps it in sync with the saved connection.

export const useJellyfinLibrary = () => {
    const refresh = useCallback(async () => {
        const connection = omni.getJellyfinConnection();
        const store = useOnlineProviderAccountStore.getState();
        if (!connection) {
            store.clearAccount('jellyfin');
            return null;
        }

        store.updateAccount('jellyfin', { status: 'authenticated', hydration: 'ready', freshness: 'refreshing', error: undefined, user: { id: connection.userId, nickname: connection.username } });
        try {
            const overview = await omni.getJellyfinHomeOverview();
            const collections = [...overview.playlists, ...overview.albums, ...overview.artists, overview.recentlyAdded, overview.recentlyPlayed, overview.favorites, overview.randomMix];
            store.updateAccount('jellyfin', {
                status: 'authenticated',
                hydration: 'ready',
                freshness: 'fresh',
                user: { id: connection.userId, nickname: connection.username },
                collections,
                lastUpdatedAt: Date.now(),
            });
            return overview;
        } catch (error) {
            const activeConnection = omni.getJellyfinConnection();
            if (!activeConnection) {
                store.clearAccount('jellyfin', error instanceof Error ? error.message : 'auth-required');
                return null;
            }
            store.updateAccount('jellyfin', { status: 'error', hydration: 'ready', freshness: 'error', error: error instanceof Error ? error.message : 'jellyfin_refresh_failed' });
            throw error;
        }
    }, []);

    const logout = useCallback(async () => {
        await omni.logoutJellyfin();
        useOnlineProviderAccountStore.getState().clearAccount('jellyfin');
    }, []);

    useEffect(() => {
        const unsubscribe = omni.subscribeJellyfinConnection(() => { void refresh().catch(() => {}); });
        void refresh().catch(() => {});
        return unsubscribe;
    }, [refresh]);

    return { refresh, logout };
};
