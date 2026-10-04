import React, { useEffect, useMemo, useState } from 'react';
import { Disc3, ListMusic, Server, Shuffle, Sparkles, Star, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import type { JellyfinHomeOverview, ProviderCollection } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';
import { useSettingsModalStore } from '../../../stores/useSettingsModalStore';
import { DesktopGrid3DSurface, type DesktopGrid3DAction } from '../../folia-grid/DesktopGrid3DSurface';
import type { Grid3DSliderItem } from '../../folia-grid/Grid3DSlider';
import { createOnlineGridViewCollection } from './gridViewCollectionAdapters';

// src/components/app/home/JellyfinGrid3DView.tsx
// Presents the selected Jellyfin libraries within the existing online home surface.

type JellyfinSection = 'playlists' | 'albums' | 'artists' | 'recentlyAdded' | 'favorites' | 'random';

type JellyfinGrid3DViewProps = {
    theme: Theme;
    isDaylight: boolean;
    isInteractive: boolean;
    hasFloatingPlayer: boolean;
    userId: string;
    selectedLibraryCount: number;
    onOpenGridView?: (collection: ReturnType<typeof createOnlineGridViewCollection>) => void;
};

const JellyfinGrid3DView: React.FC<JellyfinGrid3DViewProps> = ({
    theme, isDaylight, isInteractive, hasFloatingPlayer, userId, selectedLibraryCount, onOpenGridView,
}) => {
    const { t } = useTranslation();
    const [section, setSection] = useState<JellyfinSection>('albums');
    const [overview, setOverview] = useState<JellyfinHomeOverview | null>(null);
    const [error, setError] = useState('');
    const [focusedIndex, setFocusedIndex] = useState(0);
    const connection = omni.getJellyfinConnection();

    useEffect(() => {
        let disposed = false;
        setOverview(null);
        setError('');
        void omni.getJellyfinHomeOverview().then(result => {
            if (!disposed) setOverview(result);
        }).catch(reason => {
            if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
        });
        return () => { disposed = true; };
    }, [userId, selectedLibraryCount]);

    const sections = useMemo<Record<JellyfinSection, ProviderCollection[]>>(() => ({
        playlists: overview?.playlists || [],
        albums: overview?.albums || [],
        artists: overview?.artists || [],
        recentlyAdded: overview ? [overview.recentlyAdded] : [],
        favorites: overview ? [overview.favorites] : [],
        random: overview ? [overview.randomMix] : [],
    }), [overview]);
    const names: Record<JellyfinSection, string> = {
        playlists: t('home.playlists'), albums: t('home.albums'), artists: t('jellyfin.artists'),
        recentlyAdded: t('jellyfin.recentlyAdded'),
        favorites: t('jellyfin.favorites'), random: t('jellyfin.random'),
    };
    const items = useMemo(() => sections[section].map(collection => ({
        id: collection.id,
        name: collection.name,
        coverUrl: collection.coverUrl,
        description: collection.artists?.map(artist => artist.name).join(', ') || collection.description || names[section],
        trackCount: collection.trackCount,
        type: collection.type,
        raw: collection,
    })), [names, section, sections]);
    const tabs: DesktopGrid3DAction[] = [
        { id: 'albums', label: names.albums, icon: <Disc3 size={13} />, active: section === 'albums', onClick: () => setSection('albums') },
        { id: 'artists', label: names.artists, icon: <UserRound size={13} />, active: section === 'artists', onClick: () => setSection('artists') },
        { id: 'playlists', label: names.playlists, icon: <ListMusic size={13} />, active: section === 'playlists', onClick: () => setSection('playlists') },
        { id: 'recently-added', label: names.recentlyAdded, icon: <Sparkles size={13} />, active: section === 'recentlyAdded', onClick: () => setSection('recentlyAdded') },
        { id: 'favorites', label: names.favorites, icon: <Star size={13} />, active: section === 'favorites', onClick: () => setSection('favorites') },
        { id: 'random', label: names.random, icon: <Shuffle size={13} />, active: section === 'random', onClick: () => setSection('random') },
    ];
    const emptyMessage = error || (selectedLibraryCount === 0 ? t('jellyfin.noLibrarySelected') : t('jellyfin.emptySection'));

    if (!connection) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-5 opacity-70">
                <Server size={56} />
                <p className="text-sm">{t('jellyfin.notConfigured')}</p>
                <button
                    type="button"
                    onClick={() => useSettingsModalStore.getState().openSettings('options', 'integration', null, 'jellyfin')}
                    className="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-sm font-semibold"
                >
                    {t('jellyfin.openSettings')}
                </button>
            </div>
        );
    }

    return (
        <DesktopGrid3DSurface
            focusMemoryScope={'jellyfin:' + userId + ':' + section}
            title={names[section]}
            mapButtonLabel={t('home.allAlbums')}
            items={items as Grid3DSliderItem[]}
            focusedIndex={focusedIndex}
            onFocusedIndexChange={setFocusedIndex}
            onSelect={item => {
                const collection = (item as Grid3DSliderItem & { raw?: ProviderCollection }).raw;
                if (collection) onOpenGridView?.(createOnlineGridViewCollection(collection, 'jellyfin'));
            }}
            tabs={tabs}
            isLoading={!overview && !error}
            emptyMessage={emptyMessage}
            theme={theme}
            isDaylight={isDaylight}
            isInteractive={isInteractive}
            hasFloatingPlayer={hasFloatingPlayer}
            playlistVisibilityScope="online:jellyfin"
        />
    );
};

export default JellyfinGrid3DView;
