import React, { useMemo, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Cloud, FileText, RefreshCw, Search, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OnlineLyricsState, ReplayGainMode, SongResult } from '../../types';
import LyricTimelineOffsetControl from './LyricTimelineOffsetControl';
import LyricFileButton from './LyricFileButton';
import ReplayGainControl from './ReplayGainControl';
import { getLyricProviderLabel, getSongNativeLyricProviderSource } from '../../utils/lyrics/lyricSourceLabels';
import { jellyfinSongId } from '../../services/onlineMusic/jellyfinNormalize';

// src/components/panelTab/OnlineLyricsTab.tsx

interface OnlineLyricsTabProps {
    song: SongResult;
    hasLyrics: boolean;
    onlineLyricsState: OnlineLyricsState | null;
    onImportLyrics: (content: string, fileName: string) => void;
    onChangeLyricsSource: (source: 'online' | 'imported') => void;
    onMatchOnlineLyrics: () => void;
    onClearOnlineLyricsState: () => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    isDaylight: boolean;
    isJellyfin?: boolean;
}

const OnlineLyricsTab: React.FC<OnlineLyricsTabProps> = ({
    song,
    hasLyrics,
    onlineLyricsState,
    onImportLyrics,
    onChangeLyricsSource,
    onMatchOnlineLyrics,
    onClearOnlineLyricsState,
    lyricTimelineOffsetMs,
    onLyricTimelineOffsetChange,
    replayGainMode,
    onChangeReplayGainMode,
    isDaylight,
    isJellyfin = false,
}) => {
    const { t } = useTranslation();

    const activeTabBg = isDaylight ? 'bg-blue-500/15 text-blue-600' : 'bg-blue-500/20 text-blue-300';
    const tabContainerBg = isDaylight ? 'bg-black/5' : 'bg-white/5';
    const activePillBg = isDaylight ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'bg-zinc-800/80 shadow-[0_2px_8px_rgba(0,0,0,0.2)]';
    const activeTextColor = isDaylight ? 'text-blue-600 font-semibold' : 'text-blue-300 font-semibold';
    const inactiveTextColor = isDaylight ? 'text-zinc-500 hover:text-zinc-800' : 'text-zinc-400 hover:text-zinc-200';

    const hasImportedLyrics = Boolean(onlineLyricsState?.importedLyrics);
    const hasOverride = Boolean(onlineLyricsState?.hasOnlineOverride || onlineLyricsState?.importedLyrics);
    const activeSource = onlineLyricsState?.lyricsSource === 'imported' && hasImportedLyrics ? 'imported' : 'online';

    const onlineSourceLabel = useMemo(() => {
        return getLyricProviderLabel(
            onlineLyricsState?.matchedLyricsSource ?? getSongNativeLyricProviderSource(song),
            onlineLyricsState?.matchedLyricsProviderPlatform,
        );
    }, [onlineLyricsState, song]);

    const availableSources = useMemo(
        () => (hasImportedLyrics
            ? [
                { key: 'online' as const, label: onlineSourceLabel },
                { key: 'imported' as const, label: t('localMusic.statusImported') },
            ]
            : [{ key: 'online' as const, label: onlineSourceLabel }]),
        [hasImportedLyrics, onlineSourceLabel, t],
    );
    const jellyfinId = isJellyfin ? jellyfinSongId(song) : null;
    const lyricsSourceLabel = activeSource === 'imported' && hasImportedLyrics
        ? t('localMusic.statusImported')
        : isJellyfin && onlineLyricsState?.hasOnlineOverride
            ? onlineSourceLabel
            : isJellyfin
                ? hasLyrics ? t('navidrome.server') : t('localMusic.statusNone')
                : onlineSourceLabel;

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = nextEvent => {
            const content = nextEvent.target?.result as string | null;
            if (content) {
                onImportLyrics(content, file.name);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-4 pt-0 px-2"
        >
            {isJellyfin && (
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                        <Cloud size={14} /> Jellyfin Server
                    </h3>
                    <div className="bg-white/5 rounded-xl p-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="opacity-60">Song ID</span>
                            <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={jellyfinId ?? undefined}>
                                {jellyfinId ?? '—'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <ReplayGainControl
                values={song.replayGain}
                mode={replayGainMode}
                onChangeMode={onChangeReplayGainMode}
                isDaylight={isDaylight}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label className="text-[12px] font-bold opacity-40 uppercase tracking-widest flex items-center gap-1.5">
                            <FileText size={14} />
                            {t('localMusic.lyrics')}
                        </label>
                        {!isJellyfin && hasOverride && (
                            <button
                                onClick={onClearOnlineLyricsState}
                                className={`p-1 rounded-md transition-all opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
                                title={t('localMusic.delete')}
                            >
                                <RotateCcw size={13} />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <LyricFileButton
                            isDaylight={isDaylight}
                            onImportChange={handleImport}
                            buttonClassName={`p-1 rounded-md transition-all opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
                        />
                        <button
                            onClick={onMatchOnlineLyrics}
                            className={isJellyfin
                                ? 'px-3 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors rounded-lg text-xs font-medium flex items-center gap-1.5'
                                : `p-1 rounded-md transition-all opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
                            title={t('localMusic.matchOnline')}
                        >
                            {isJellyfin ? <><RefreshCw size={12} />{t('localMusic.matchOnline')}</> : <Search size={14} />}
                        </button>
                    </div>
                </div>

                {isJellyfin || availableSources.length === 1 ? (
                    <div className={`flex items-center justify-between ${isDaylight ? 'bg-black/5' : 'bg-white/5'} rounded-lg p-2 pl-3`}>
                        <span className="text-[11px] opacity-60">
                            {t('localMusic.lyricsSource')}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${activeTabBg}`}>
                            {lyricsSourceLabel}
                        </span>
                    </div>
                ) : (
                    <div className={`relative flex p-0.5 ${tabContainerBg} rounded-lg`}>
                        {availableSources.map(source => {
                            const isActive = activeSource === source.key;
                            return (
                                <button
                                    key={source.key}
                                    onClick={() => onChangeLyricsSource(source.key)}
                                    className={`flex-1 relative text-[10px] py-1 px-1.5 rounded-md font-medium transition-colors duration-200 focus:outline-none ${
                                        isActive ? activeTextColor : inactiveTextColor
                                    }`}
                                >
                                    {isActive && (
                                        <motion.span
                                            layoutId="online-lyrics-active-pill"
                                            className={`absolute inset-0 rounded-md ${activePillBg}`}
                                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                        />
                                    )}
                                    <span className="relative z-10">{source.label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <LyricTimelineOffsetControl
                    offsetMs={lyricTimelineOffsetMs}
                    onOffsetChange={onLyricTimelineOffsetChange}
                    isDaylight={isDaylight}
                />
            </div>
        </motion.div>
    );
};

export default OnlineLyricsTab;
