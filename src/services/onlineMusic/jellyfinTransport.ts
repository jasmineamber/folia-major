import type { JellyfinConnectionState, JellyfinLibrary } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/onlineMusic/jellyfinTransport.ts
// Owns Jellyfin HTTP requests, token persistence, and server URL construction.

const SESSION_STORAGE_KEY = 'folia_jellyfin_session';
const CONNECTION_EVENT = 'folia:jellyfin-connection-change';
const CLIENT_NAME = 'Folia';
const CLIENT_VERSION = '0.7.12';

export type JellyfinFailureKind = 'cors' | 'auth' | 'request' | 'unsupported-server';

export class JellyfinApiError extends Error {
    constructor(
        public readonly kind: JellyfinFailureKind,
        message: string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'JellyfinApiError';
    }
}

export interface JellyfinSession extends JellyfinConnectionState {
    accessToken: string;
    deviceId: string;
    sessionId?: string;
    serverVersion?: string;
}

export interface JellyfinItemRecord extends Record<string, unknown> {
    Id?: string;
    Name?: string;
    Type?: string;
}

export interface JellyfinItemsResponse {
    Items?: JellyfinItemRecord[];
    TotalRecordCount?: number;
}

export interface JellyfinPlaybackInfo {
    MediaSources?: Array<{
        Id?: string;
        SupportsDirectPlay?: boolean;
        SupportsDirectStream?: boolean;
        SupportsTranscoding?: boolean;
        DirectStreamUrl?: string;
        TranscodingUrl?: string;
        Path?: string;
        Container?: string;
        MediaStreams?: Array<Record<string, unknown>>;
    }>;
    PlaySessionId?: string;
}

export interface JellyfinResolvedPlayback {
    url: string;
    mediaSourceId?: string;
    playSessionId?: string;
    playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
}

type JellyfinRequestOptions = {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    authenticated?: boolean;
    authorizationHeader?: string;
};

const getStorage = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

const normalizeServerUrl = (value: string): string => {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new JellyfinApiError('request', 'Jellyfin server URL must use HTTP or HTTPS.');
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
};

export const readJellyfinSession = (): JellyfinSession | null => {
    const storage = getStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<JellyfinSession>;
        if (!value.serverUrl || !value.username || !value.userId || !value.accessToken) return null;
        return {
            serverUrl: normalizeServerUrl(value.serverUrl),
            username: value.username,
            userId: value.userId,
            accessToken: value.accessToken,
            deviceId: value.deviceId || createDeviceId(),
            selectedLibraryIds: Array.isArray(value.selectedLibraryIds)
                ? value.selectedLibraryIds.filter((id): id is string => typeof id === 'string')
                : [],
            ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
            ...(typeof value.serverVersion === 'string' ? { serverVersion: value.serverVersion } : {}),
        };
    } catch {
        return null;
    }
};

const createDeviceId = (): string => {
    try {
        return 'folia-' + crypto.randomUUID();
    } catch {
        return 'folia-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
};

const notifyConnectionChange = (): void => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONNECTION_EVENT));
};

const writeSession = (session: JellyfinSession): void => {
    getStorage()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    notifyConnectionChange();
};

export const clearJellyfinSession = (): void => {
    getStorage()?.removeItem(SESSION_STORAGE_KEY);
    notifyConnectionChange();
};

export const subscribeJellyfinConnection = (listener: () => void): (() => void) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener(CONNECTION_EVENT, listener);
    window.addEventListener('storage', listener);
    return () => {
        window.removeEventListener(CONNECTION_EVENT, listener);
        window.removeEventListener('storage', listener);
    };
};

export const getJellyfinConnectionState = (): JellyfinConnectionState | null => {
    const session = readJellyfinSession();
    if (!session) return null;
    return {
        serverUrl: session.serverUrl,
        username: session.username,
        userId: session.userId,
        selectedLibraryIds: [...session.selectedLibraryIds],
    };
};

const getSession = (): JellyfinSession => {
    const session = readJellyfinSession();
    if (!session) throw new OnlineProviderError('auth-required', 'Connect a Jellyfin server first.', 'jellyfin');
    return session;
};

const buildUrl = (
    session: Pick<JellyfinSession, 'serverUrl'>,
    path: string,
    query?: JellyfinRequestOptions['query'],
): URL => {
    const url = new URL(session.serverUrl + '/' + path.replace(/^\/+/, ''));
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && key !== 'serverUrl') url.searchParams.set(key, String(value));
    });
    return url;
};

const request = async <T>(path: string, options: JellyfinRequestOptions = {}): Promise<T> => {
    const session = options.authenticated === false ? null : getSession();
    const serverUrl = session?.serverUrl || (options.query?.serverUrl as string | undefined);
    if (!serverUrl) throw new JellyfinApiError('request', 'Jellyfin server URL is missing.');

    const requestSession = session || { serverUrl, deviceId: createDeviceId() } as JellyfinSession;
    const url = buildUrl(requestSession, path, options.query);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (session) {
        headers.Authorization = 'MediaBrowser Client="' + CLIENT_NAME + '", Device="Folia", DeviceId="'
            + session.deviceId + '", Version="' + CLIENT_VERSION + '", Token="' + session.accessToken + '"';
    } else if (options.authorizationHeader) {
        headers.Authorization = options.authorizationHeader;
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: options.method || 'GET',
            headers,
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
    } catch (error) {
        if (error instanceof TypeError) {
            throw new JellyfinApiError(
                'cors',
                'Folia could not reach Jellyfin. Check the server address and allow this Folia origin in Jellyfin Dashboard > Networking > CORS Hosts.',
            );
        }
        throw error;
    }

    if (response.status === 401) {
        if (session) {
            clearJellyfinSession();
            throw new JellyfinApiError('auth', 'Jellyfin sign-in expired. Please sign in again.', response.status);
        }
        throw new JellyfinApiError('auth', 'Jellyfin rejected the username or password.', response.status);
    }
    if (!response.ok) {
        let detail = '';
        try {
            const payload = await response.json() as { Message?: unknown; message?: unknown };
            detail = String(payload.Message || payload.message || '');
        } catch {
            // Some Jellyfin endpoints respond with an empty body on errors.
        }
        throw new JellyfinApiError('request', detail || ('Jellyfin request failed (' + response.status + ').'), response.status);
    }
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) return undefined as T;
    return await response.json() as T;
};

export const jellyfinTransport = {
    getConnection: getJellyfinConnectionState,

    logout(): void {
        clearJellyfinSession();
    },

    async login(serverUrl: string, username: string, password: string): Promise<JellyfinConnectionState> {
        let normalizedUrl: string;
        try {
            normalizedUrl = normalizeServerUrl(serverUrl);
        } catch (error) {
            if (error instanceof JellyfinApiError) throw error;
            throw new JellyfinApiError('request', 'Enter a valid Jellyfin server URL.');
        }

        const deviceId = createDeviceId();
        const result = await request<{
            AccessToken?: string;
            User?: { Id?: string; Name?: string };
            SessionInfo?: { Id?: string };
        }>('Users/AuthenticateByName', {
            method: 'POST',
            authenticated: false,
            authorizationHeader: 'MediaBrowser Client="' + CLIENT_NAME + '", Device="Folia", DeviceId="'
                + deviceId + '", Version="' + CLIENT_VERSION + '", App="Folia"',
            query: { serverUrl: normalizedUrl },
            body: { Username: username, Pw: password },
        });
        if (!result.AccessToken || !result.User?.Id) {
            throw new JellyfinApiError('request', 'Jellyfin returned an incomplete sign-in response.');
        }

        const session: JellyfinSession = {
            serverUrl: normalizedUrl,
            username: result.User.Name || username,
            userId: result.User.Id,
            accessToken: result.AccessToken,
            deviceId,
            ...(result.SessionInfo?.Id ? { sessionId: result.SessionInfo.Id } : {}),
            selectedLibraryIds: [],
        };
        writeSession(session);
        let info: { Version?: string };
        try {
            info = await request<{ Version?: string }>('System/Info/Public');
        } catch (error) {
            // The authenticated version probe happens after persisting the token so request() can
            // authenticate it. Roll back that provisional session on CORS, network, or auth failure.
            clearJellyfinSession();
            throw error;
        }
        const versionText = info.Version || '';
        const version = versionText.split('.').map(Number);
        if (!versionText || !Number.isFinite(version[0]) || !Number.isFinite(version[1])) {
            clearJellyfinSession();
            throw new JellyfinApiError('request', 'Jellyfin did not report a valid server version.');
        }
        if (version[0] < 10 || (version[0] === 10 && version[1] < 10)) {
            clearJellyfinSession();
            throw new JellyfinApiError('unsupported-server', 'Folia requires Jellyfin 10.10 or newer.');
        }
        session.serverVersion = versionText;
        writeSession(session);
        return getJellyfinConnectionState()!;
    },

    async getLibraries(): Promise<JellyfinLibrary[]> {
        const session = getSession();
        const result = await request<{ Items?: JellyfinItemRecord[] }>('Users/' + encodeURIComponent(session.userId) + '/Views');
        return (result.Items || [])
            .filter(item => String(item.CollectionType || '').toLowerCase() === 'music')
            .filter(item => typeof item.Id === 'string' && typeof item.Name === 'string')
            .map(item => ({ id: String(item.Id), name: String(item.Name) }));
    },

    async setSelectedLibraries(libraryIds: string[]): Promise<void> {
        const session = getSession();
        const validIds = new Set((await this.getLibraries()).map(library => library.id));
        const uniqueIds = [...new Set(libraryIds)].filter(id => validIds.has(id));
        writeSession({ ...session, selectedLibraryIds: uniqueIds });
    },

    async getItems(query: Record<string, string | number | boolean | undefined>): Promise<JellyfinItemsResponse> {
        const session = getSession();
        return request<JellyfinItemsResponse>('Users/' + encodeURIComponent(session.userId) + '/Items', {
            query: { ...query, Fields: query.Fields || 'PrimaryImageAspectRatio,DateCreated,UserData,MediaSources' },
        });
    },

    async getItem(itemId: string): Promise<JellyfinItemRecord> {
        const session = getSession();
        return request<JellyfinItemRecord>('Users/' + encodeURIComponent(session.userId) + '/Items/' + encodeURIComponent(itemId), {
            query: { Fields: 'PrimaryImageAspectRatio,DateCreated,UserData,MediaSources,ParentId' },
        });
    },

    getSelectedLibraryIds(): string[] {
        return [...(readJellyfinSession()?.selectedLibraryIds || [])];
    },

    async getPlaylistItems(playlistId: string, page?: { limit: number; offset: number }): Promise<JellyfinItemsResponse> {
        const session = getSession();
        return request<JellyfinItemsResponse>('Playlists/' + encodeURIComponent(playlistId) + '/Items', {
            query: {
                UserId: session.userId,
                Fields: 'PrimaryImageAspectRatio,UserData,PlaylistItemId,MediaSources',
                ...(page ? { StartIndex: page.offset, Limit: page.limit } : {}),
            },
        });
    },

    async createPlaylist(name: string, songs: Array<{ id: string | number }> = []): Promise<JellyfinItemRecord> {
        const session = getSession();
        return request<JellyfinItemRecord>('Playlists', {
            method: 'POST',
            query: {
                Name: name,
                UserId: session.userId,
                Ids: songs.length ? songs.map(song => String(song.id)).join(',') : undefined,
            },
        });
    },

    async renamePlaylist(playlistId: string, name: string): Promise<void> {
        await request('Items/' + encodeURIComponent(playlistId), { method: 'POST', body: { Name: name } });
    },

    async deletePlaylist(playlistId: string): Promise<void> {
        await request('Items/' + encodeURIComponent(playlistId), { method: 'DELETE' });
    },

    async mutatePlaylistTracks(playlistId: string, operation: 'add' | 'del', itemIds: string[]): Promise<void> {
        if (operation === 'add') {
            await request('Playlists/' + encodeURIComponent(playlistId) + '/Items', {
                method: 'POST', query: { Ids: itemIds.join(',') },
            });
            return;
        }
        const { Items = [] } = await this.getPlaylistItems(playlistId, { limit: 10_000, offset: 0 });
        const targetIds = new Set(itemIds);
        const entryIds = Items
            .filter(item => targetIds.has(String(item.PlaylistItemId || '')) || targetIds.has(String(item.Id)))
            .map(item => String(item.PlaylistItemId || ''))
            .filter(Boolean);
        if (entryIds.length) {
            await request('Playlists/' + encodeURIComponent(playlistId) + '/Items', {
                method: 'DELETE', query: { EntryIds: entryIds.join(',') },
            });
        }
    },

    async setFavorite(itemId: string, favorite: boolean): Promise<void> {
        const session = getSession();
        await request('Users/' + encodeURIComponent(session.userId) + '/FavoriteItems/' + encodeURIComponent(itemId), {
            method: favorite ? 'POST' : 'DELETE',
        });
    },

    async getLyrics(itemId: string): Promise<unknown> {
        return request('Audio/' + encodeURIComponent(itemId) + '/Lyrics');
    },

    async getPlaybackInfo(itemId: string, deviceProfile: unknown): Promise<JellyfinPlaybackInfo> {
        const session = getSession();
        return request<JellyfinPlaybackInfo>('Items/' + encodeURIComponent(itemId) + '/PlaybackInfo', {
            method: 'POST',
            query: { UserId: session.userId },
            body: {
                UserId: session.userId,
                EnableDirectPlay: true,
                EnableDirectStream: true,
                EnableTranscoding: true,
                DeviceProfile: deviceProfile,
            },
        });
    },

    getPlaybackUrl(itemId: string, info: JellyfinPlaybackInfo): JellyfinResolvedPlayback {
        const session = getSession();
        const mediaSources = info.MediaSources || [];
        const selected = mediaSources.find(source => source.SupportsDirectPlay)
            || mediaSources.find(source => source.SupportsDirectStream)
            || mediaSources.find(source => source.SupportsTranscoding)
            || mediaSources[0];
        const mediaSourceId = selected?.Id;
        const playSessionId = info.PlaySessionId;
        const playMethod = selected?.SupportsDirectPlay
            ? 'DirectPlay'
            : selected?.SupportsDirectStream
                ? 'DirectStream'
                : 'Transcode';
        const fallbackPath = playMethod === 'DirectPlay'
            ? 'Audio/' + encodeURIComponent(itemId) + '/stream'
            : 'Audio/' + encodeURIComponent(itemId) + '/universal';
        const playbackPath = playMethod === 'Transcode' ? selected?.TranscodingUrl : selected?.DirectStreamUrl;
        const url = new URL(playbackPath || fallbackPath, session.serverUrl + '/');
        if (mediaSourceId && !url.searchParams.has('MediaSourceId')) url.searchParams.set('MediaSourceId', mediaSourceId);
        if (playSessionId && !url.searchParams.has('PlaySessionId')) url.searchParams.set('PlaySessionId', playSessionId);
        if (playMethod === 'DirectPlay' && !url.searchParams.has('static')) url.searchParams.set('static', 'true');
        if (playMethod === 'Transcode') {
            if (!url.searchParams.has('UserId')) url.searchParams.set('UserId', session.userId);
            if (!url.searchParams.has('DeviceId')) url.searchParams.set('DeviceId', session.deviceId);
            if (!url.searchParams.has('Container')) url.searchParams.set('Container', 'mp3');
            if (!url.searchParams.has('AudioCodec')) url.searchParams.set('AudioCodec', 'mp3');
            if (!url.searchParams.has('TranscodingProtocol')) url.searchParams.set('TranscodingProtocol', 'http');
        }
        if (!url.searchParams.has('api_key')) url.searchParams.set('api_key', session.accessToken);
        return { url: url.toString(), mediaSourceId, playSessionId, playMethod };
    },

    resolveMediaUrl(value: string): string {
        const session = getSession();
        const url = new URL(value, session.serverUrl + '/');
        if (!url.searchParams.has('api_key')) url.searchParams.set('api_key', session.accessToken);
        return url.toString();
    },

    getImageUrl(itemId: string, imageTag?: string, size = 600): string {
        const session = getSession();
        const url = buildUrl(session, 'Items/' + encodeURIComponent(itemId) + '/Images/Primary', {
            maxWidth: size,
            ...(imageTag ? { tag: imageTag } : {}),
            api_key: session.accessToken,
        });
        return url.toString();
    },

    async reportPlayback(path: 'Sessions/Playing' | 'Sessions/Playing/Progress' | 'Sessions/Playing/Stopped', body: unknown): Promise<void> {
        await request(path, { method: 'POST', body });
    },

    getPlaybackIdentity(): { userId: string; deviceId: string; sessionId?: string } {
        const session = getSession();
        return {
            userId: session.userId,
            deviceId: session.deviceId,
            ...(session.sessionId ? { sessionId: session.sessionId } : {}),
        };
    },

    getPlaybackSessionId(): string | undefined {
        return readJellyfinSession()?.sessionId;
    },
};
