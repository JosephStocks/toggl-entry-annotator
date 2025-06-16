import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { MantineProvider } from '@mantine/core';

// Helper to render App with MantineProvider
function renderWithProvider() {
    return render(
        <MantineProvider>
            <App />
        </MantineProvider>
    );
}

// Helper to mock fetch
function mockFetchOnce(data: any, ok = true) {
    window.fetch = vi.fn().mockResolvedValue({
        ok,
        json: async () => data,
    }) as any;
}

describe('App', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows loading state', async () => {
        mockFetchOnce([]);
        renderWithProvider();
        expect(screen.getByRole('status')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    });

    it('shows error state', async () => {
        window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }) as any;
        renderWithProvider();
        await screen.findByText(/HTTP 500/i);
    });

    it('shows empty state', async () => {
        mockFetchOnce([]);
        renderWithProvider();
        await screen.findByText(/No time entries found/i);
    });

    it('shows populated state', async () => {
        mockFetchOnce([
            {
                entry_id: 1,
                description: 'Test Entry',
                project_name: 'Test Project',
                seconds: 120,
                start: '2025-01-01T10:00:00Z',
                notes: [
                    { id: 1, note_text: 'A note', created_at: '2025-01-01T11:00:00Z' },
                ],
            },
        ]);
        renderWithProvider();
        await screen.findByText('Test Entry');
        expect(screen.getByText('Test Project')).toBeInTheDocument();
        expect(screen.getByText('A note')).toBeInTheDocument();
    });

    it('can add a note', async () => {
        // First fetch: entries with no notes
        mockFetchOnce([
            {
                entry_id: 2,
                description: 'Entry',
                project_name: 'Proj',
                seconds: 60,
                start: '2025-01-01T10:00:00Z',
                notes: [],
            },
        ]);
        renderWithProvider();
        await screen.findByText('Entry');
        // Mock add note fetch
        const addNoteMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        // Next fetch: entry with note
        const refreshed = [
            {
                entry_id: 2,
                description: 'Entry',
                project_name: 'Proj',
                seconds: 60,
                start: '2025-01-01T10:00:00Z',
                notes: [
                    { id: 2, note_text: 'New note', created_at: '2025-01-01T12:00:00Z' },
                ],
            },
        ];
        let call = 0;
        window.fetch = vi.fn((...args) => {
            if (typeof args[0] === 'string' && args[0].includes('/notes')) {
                return Promise.resolve({ ok: true });
            }
            // First call: initial entries, Second call: after add
            return Promise.resolve({
                ok: true,
                json: async () => (call++ === 0 ? refreshed : refreshed),
            });
        }) as any;
        // Type in note and submit
        const input = await screen.findByPlaceholderText('Add a note...');
        await userEvent.type(input, 'New note');
        await userEvent.click(screen.getByText('Add'));
        await screen.findByText('New note');
    });

    it('navigates dates', async () => {
        mockFetchOnce([]);
        renderWithProvider();
        await screen.findByText(/No time entries found/i);
        // Go to previous day to ensure "Go to Today" button appears
        mockFetchOnce([]);
        await userEvent.click(screen.getByLabelText('Previous day'));
        await screen.findByText(/No time entries found/i);
        // Now the "Go to Today" button should be present
        mockFetchOnce([]);
        await userEvent.click(screen.getByRole('button', { name: /go to today/i }));
        await screen.findByText(/No time entries found/i);
    });
}); 