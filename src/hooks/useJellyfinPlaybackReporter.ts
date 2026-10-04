import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SongResult } from '../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { omni } from '../services/onlineMusic/omni';

// src/hooks/useJellyfinPlaybackReporter.ts
// Reports real Jellyfin audio lifecycle events without ever sending the media URL.

type UseJellyfinPlaybackReporterParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    activeDeck: string;
};

export const useJellyfinPlaybackReporter = ({ audioRef, currentSong, activeDeck }: UseJellyfinPlaybackReporterParams): void => {
    const source = currentSong ? getPlaybackSourceRef(currentSong) : null;
    const songKey = source?.kind === 'online' && source.providerId === 'jellyfin'
        ? getPlaybackSongKey(currentSong!)
        : null;
    const songRef = useRef<SongResult | null>(currentSong);
    const sessionRef = useRef<{ key: string | null; song: SongResult | null; started: boolean; stopped: boolean }>({
        key: null,
        song: null,
        started: false,
        stopped: false,
    });
    songRef.current = currentSong;
    if (songKey && sessionRef.current.key === songKey) sessionRef.current.song = currentSong;

    useEffect(() => {
        const session = sessionRef.current;
        session.key = songKey;
        session.song = songKey ? songRef.current : null;
        session.started = false;
        session.stopped = false;

        return () => {
            if (!session.started || session.stopped || !session.song) return;
            session.stopped = true;
            void omni.reportJellyfinPlaybackEvent(session.song, {
                kind: 'stopped',
                positionSeconds: audioRef.current?.currentTime || 0,
            })
                .catch(error => console.warn('[JellyfinPlaybackReporter] Playback event failed:', error));
        };
    }, [audioRef, songKey]);

    useEffect(() => {
        const audio = audioRef.current;
        const session = sessionRef.current;
        if (!audio || !songKey || session.key !== songKey || !session.song) return;

        let lastProgressAt = 0;
        const report = (kind: 'start' | 'progress' | 'stopped', isPaused = false) => {
            const currentSession = sessionRef.current;
            if (currentSession.key !== songKey || !currentSession.song) return;
            void omni.reportJellyfinPlaybackEvent(currentSession.song, { kind, positionSeconds: audio.currentTime || 0, isPaused })
                .catch(error => console.warn('[JellyfinPlaybackReporter] Playback event failed:', error));
        };
        const start = () => {
            const currentSession = sessionRef.current;
            if (currentSession.key !== songKey || currentSession.started || !currentSession.song) return;
            currentSession.started = true;
            report('start');
        };
        const handleTimeUpdate = () => {
            if (audio.seeking || audio.paused || audio.ended) return;
            if (!sessionRef.current.started) start();
            const now = Date.now();
            if (now - lastProgressAt >= 15_000) {
                lastProgressAt = now;
                report('progress');
            }
        };
        const handlePause = () => {
            if (sessionRef.current.started && !audio.ended) report('progress', true);
        };
        const stop = () => {
            const currentSession = sessionRef.current;
            if (currentSession.key !== songKey || !currentSession.started || currentSession.stopped) return;
            currentSession.stopped = true;
            report('stopped');
        };

        audio.addEventListener('play', start);
        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('ended', stop);
        if (!audio.paused) start();

        return () => {
            audio.removeEventListener('play', start);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('ended', stop);
        };
    }, [activeDeck, audioRef, songKey]);
};
