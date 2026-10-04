import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, LogOut, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JellyfinLibrary } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';

// src/components/modal/settings/JellyfinSettingsSection.tsx
// Jellyfin sign-in, selected music libraries, and actionable connection errors.

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed';

type JellyfinSettingsSectionProps = {
    successBgColor: string;
    successTextColor: string;
    errorBgColor: string;
    errorTextColor: string;
    settingsCardClass: string;
};

const JellyfinSettingsSection: React.FC<JellyfinSettingsSectionProps> = ({
    successBgColor, successTextColor, errorBgColor, errorTextColor, settingsCardClass,
}) => {
    const { t } = useTranslation();
    const connection = omni.getJellyfinConnection();
    const [serverUrl, setServerUrl] = useState(connection?.serverUrl || '');
    const [username, setUsername] = useState(connection?.username || '');
    const [password, setPassword] = useState('');
    const [libraries, setLibraries] = useState<JellyfinLibrary[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>(connection?.selectedLibraryIds || []);
    const [status, setStatus] = useState<ConnectionStatus>(connection ? 'connected' : 'idle');
    const [error, setError] = useState('');

    useEffect(() => {
        let disposed = false;
        if (!connection) return;
        void omni.getJellyfinLibraries().then(items => {
            if (!disposed) setLibraries(items);
        }).catch(reason => {
            if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
        });
        return () => { disposed = true; };
    }, []);

    const connect = async () => {
        setStatus('connecting');
        setError('');
        try {
            const saved = await omni.loginJellyfin(serverUrl, username, password);
            const available = await omni.getJellyfinLibraries();
            setLibraries(available);
            setSelectedIds(saved.selectedLibraryIds);
            setServerUrl(saved.serverUrl);
            setUsername(saved.username);
            setPassword('');
            setStatus('connected');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            setStatus('failed');
        }
    };

    const toggleLibrary = async (libraryId: string) => {
        const previous = selectedIds;
        const next = previous.includes(libraryId)
            ? previous.filter(id => id !== libraryId)
            : [...previous, libraryId];
        setSelectedIds(next);
        setError('');
        try {
            await omni.setJellyfinLibraries(next);
        } catch (reason) {
            setSelectedIds(previous);
            setError(reason instanceof Error ? reason.message : String(reason));
        }
    };

    const disconnect = async () => {
        await omni.logoutJellyfin();
        setLibraries([]);
        setSelectedIds([]);
        setPassword('');
        setStatus('idle');
        setError('');
    };

    return (
        <section className={'rounded-xl border p-4 space-y-4 ' + settingsCardClass} data-settings-anchor="jellyfin">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-60 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Server size={14} /> Jellyfin
                </h3>
                {status === 'connected' && <span className={'px-2 py-0.5 ' + successBgColor + ' ' + successTextColor + ' text-xs rounded-full'}>{t('status.connected')}</span>}
            </div>
            <label className="block space-y-1.5 text-sm">
                <span>{t('jellyfin.serverUrl')}</span>
                <input type="url" value={serverUrl} onChange={event => setServerUrl(event.target.value)} placeholder="https://music.example.com" disabled={status === 'connected'} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg" />
            </label>
            <label className="block space-y-1.5 text-sm">
                <span>{t('jellyfin.username')}</span>
                <input value={username} onChange={event => setUsername(event.target.value)} disabled={status === 'connected'} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg" />
            </label>
            {status !== 'connected' && (
                <label className="block space-y-1.5 text-sm">
                    <span>{t('jellyfin.password')}</span>
                    <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg" />
                </label>
            )}
            {status === 'connected' && (
                <div className="space-y-2">
                    <div className="text-xs opacity-60">{t('jellyfin.selectLibraries')}</div>
                    {libraries.length === 0 ? <p className="text-xs opacity-50">{t('jellyfin.noLibraries')}</p> : libraries.map(library => (
                        <label key={library.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={selectedIds.includes(library.id)} onChange={() => void toggleLibrary(library.id)} />
                            <span>{library.name}</span>
                        </label>
                    ))}
                    {selectedIds.length === 0 && <p className="text-xs opacity-60">{t('jellyfin.noLibrarySelected')}</p>}
                </div>
            )}
            <div className="text-xs opacity-60">{t('jellyfin.corsHint')}</div>
            {error && <div role="alert" className={'flex gap-2 rounded-lg p-2 text-xs ' + errorBgColor + ' ' + errorTextColor}><AlertCircle size={15} className="shrink-0" /><span>{error}</span></div>}
            <div className="flex gap-2">
                {status === 'connected' ? (
                    <button onClick={() => void disconnect()} className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-white/10 py-2 text-sm"><LogOut size={15} />{t('jellyfin.disconnect')}</button>
                ) : (
                    <button onClick={() => void connect()} disabled={status === 'connecting' || !serverUrl.trim() || !username.trim() || !password} className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-white/10 py-2 text-sm disabled:opacity-40">
                        {status === 'connecting' ? <Loader2 size={15} className="animate-spin" /> : status === 'failed' ? <AlertCircle size={15} /> : <Check size={15} />}
                        {status === 'connecting' ? t('jellyfin.connecting') : status === 'failed' ? t('jellyfin.retry') : t('jellyfin.connect')}
                    </button>
                )}
            </div>
        </section>
    );
};

export default JellyfinSettingsSection;
