import { afterEach, describe, expect, it, vi } from 'vitest';
import { JellyfinApiError, jellyfinTransport } from '@/services/onlineMusic/jellyfinTransport';

// test/unit/onlineMusic/jellyfinTransport.test.ts

const storage = () => {
    const values = new Map<string, string>();
    return {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
    };
};

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('jellyfinTransport', () => {
    it('authenticates, checks the server version, and persists no password', async () => {
        const localStorage = storage();
        vi.stubGlobal('localStorage', localStorage);
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ AccessToken: 'token-1', User: { Id: 'user-1', Name: 'Listener' } }))
            .mockResolvedValueOnce(jsonResponse({ Version: '10.10.7' }));
        vi.stubGlobal('fetch', fetchMock);

        const connection = await jellyfinTransport.login('https://music.example.test/', 'listener', 'private-password');

        expect(connection).toMatchObject({
            serverUrl: 'https://music.example.test', username: 'Listener', userId: 'user-1', selectedLibraryIds: [],
        });
        expect(fetchMock.mock.calls[0][0].toString()).toBe('https://music.example.test/Users/AuthenticateByName');
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ Username: 'listener', Pw: 'private-password' });
        const persisted = localStorage.setItem.mock.calls.at(-1)?.[1] || '';
        expect(persisted).toContain('token-1');
        expect(persisted).not.toContain('private-password');
        expect(persisted).toContain('10.10.7');
    });

    it('clears a persisted session and reports expired authentication after a 401', async () => {
        const localStorage = storage();
        localStorage.getItem.mockReturnValue(JSON.stringify({
            serverUrl: 'https://music.example.test', username: 'listener', userId: 'user-1',
            accessToken: 'expired-token', deviceId: 'device-1', selectedLibraryIds: [],
        }));
        vi.stubGlobal('localStorage', localStorage);
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

        await expect(jellyfinTransport.getLibraries()).rejects.toMatchObject({
            name: 'JellyfinApiError', kind: 'auth', status: 401,
        });
        expect(localStorage.removeItem).toHaveBeenCalledWith('folia_jellyfin_session');
    });

    it('sends favorite changes to the authenticated Jellyfin user endpoint', async () => {
        const localStorage = storage();
        localStorage.getItem.mockReturnValue(JSON.stringify({
            serverUrl: 'https://music.example.test', username: 'listener', userId: 'user-1',
            accessToken: 'token-1', deviceId: 'device-1', selectedLibraryIds: [],
        }));
        vi.stubGlobal('localStorage', localStorage);
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);

        await jellyfinTransport.setFavorite('track-1', true);

        expect(fetchMock).toHaveBeenCalledWith(
            expect.objectContaining({ pathname: '/Users/user-1/FavoriteItems/track-1' }),
            expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: expect.stringContaining('Token="token-1"') }) }),
        );
    });

    it('explains the Jellyfin CORS setup when the browser cannot reach the server', async () => {
        const localStorage = storage();
        vi.stubGlobal('localStorage', localStorage);
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

        await expect(jellyfinTransport.login('https://music.example.test', 'listener', 'password'))
            .rejects.toMatchObject({
                name: 'JellyfinApiError', kind: 'cors',
                message: expect.stringContaining('Networking > CORS Hosts'),
            } satisfies Partial<JellyfinApiError>);
    });
});
