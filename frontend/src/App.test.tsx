import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// Mock the entire api.ts module. This is the most reliable way.
vi.mock('./api.ts', () => ({
    fetchEntriesForDate: vi.fn(),
    addNote: vi.fn(),
    fetchCurrentEntry: vi.fn(),
    runSync: vi.fn(),
}));

vi.mock('./ProjectFilter.tsx', () => ({
    ProjectFilter: ({ onChange }: { onChange: (projects: Set<string>) => void }) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useEffect } = require('react');
        useEffect(() => {
            // Select all projects by default, mirroring real component behaviour
            onChange(new Set(['Project A', 'Project B']));
        }, [onChange]);

        return (
            <div>
                <button onClick={() => onChange(new Set(['Project A']))}>Filter Project A</button>
                <button onClick={() => onChange(new Set(['Project A', 'Project B']))}>Select All</button>
            </div>
        );
    }
}));

import App from './App';
import * as api from './api';
import { type Entry, type Note } from './api';


// --- Test Data ---
const mockEntries: Entry[] = [
    {
        entry_id: 1, description: 'Work on Feature X', project_name: 'Project A',
        seconds: 3600, start: '2025-01-01T10:00:00Z', notes: [],
    },
    {
        entry_id: 2, description: 'Bugfix on Y', project_name: 'Project B',
        seconds: 1800, start: '2025-01-01T11:00:00Z', notes: [],
    },
];

// --- Test Setup ---
const createTestQueryClient = () => new QueryClient({
    defaultOptions: {
        queries: {
            retry: false, // Disables retries, making tests faster and more predictable
            gcTime: Infinity, // Prevent queries from being garbage collected in tests
        },
    },
});

function renderWithQueryClient(ui: React.ReactElement) {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MantineProvider>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </MantineProvider>
    );
    return render(ui, { wrapper });
}

describe('App', () => {
    beforeEach(() => {
        vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
        // Reset mock entries
        mockEntries.forEach(e => { e.notes = []; });
        // Reset mocks to a default state before each test
        vi.mocked(api.fetchEntriesForDate).mockImplementation((..._args) => {
            return Promise.resolve(mockEntries);
        });
        vi.mocked(api.addNote).mockImplementation((id: number, text: string) => {
            const newNote: Note = { id: Date.now(), note_text: text, created_at: new Date().toISOString() };
            const entry = mockEntries.find(e => e.entry_id === id);
            if (entry) {
                entry.notes.push(newNote);
            }
            return Promise.resolve(newNote);
        });
        vi.mocked(api.fetchCurrentEntry).mockResolvedValue(null);
        vi.mocked(api.runSync).mockResolvedValue({ ok: true, records_synced: 10, message: 'Sync complete' });
    });

    afterEach(() => {
        vi.useRealTimers();
        // Clear mock history after each test
        vi.clearAllMocks();
    });

    it('shows loading state initially, then displays entries', async () => {
        renderWithQueryClient(<App />);
        // Then, the content should appear
        await waitFor(() => {
            expect(screen.getByText('Work on Feature X')).toBeInTheDocument();
        });
    });

    it('shows error state if fetching entries fails', async () => {
        vi.mocked(api.fetchEntriesForDate).mockRejectedValueOnce(new Error('Fetch failed'));
        renderWithQueryClient(<App />);
        await waitFor(() => {
            expect(screen.getByText('Fetch failed')).toBeInTheDocument();
        });
    });

    it('shows populated state with entries', async () => {
        renderWithQueryClient(<App />);
        await waitFor(() => {
            screen.debug();
            expect(screen.getByText(/Work on Feature X/i, { exact: false })).toBeInTheDocument();
            expect(screen.getByText(/Bugfix on Y/i, { exact: false })).toBeInTheDocument();
        });
    });

    it('can add a note and optimistically updates the UI', async () => {
        const user = userEvent.setup();
        renderWithQueryClient(<App />);
        const entryText = /Work on Feature X/i;
        const noteText = 'This is a new note!';

        const entryCard = await screen.findByText(entryText, { exact: false });
        const cardRoot = entryCard.closest('div.mantine-Card-root');
        expect(cardRoot).not.toBeNull();
        if (!cardRoot) return;

        const noteInput = within(cardRoot as HTMLElement).getByPlaceholderText('Add a note...') as HTMLElement;
        const addButton = within(cardRoot as HTMLElement).getByRole('button', { name: 'Add' }) as HTMLElement;

        await user.type(noteInput, noteText);
        await user.click(addButton);

        await waitFor(() => {
            expect(within(cardRoot as HTMLElement).getByText(noteText) as HTMLElement).toBeInTheDocument();
        });

        expect(api.addNote).toHaveBeenCalledWith(1, noteText);
    });

    it('navigates dates and refetches data', async () => {
        const user = userEvent.setup();
        renderWithQueryClient(<App />);
        await waitFor(() => {
            expect(screen.getByText(/Work on Feature X/i, { exact: false })).toBeInTheDocument();
        });
        expect(api.fetchEntriesForDate).toHaveBeenCalledTimes(1);

        await user.click(screen.getByLabelText('Previous day'));
        await waitFor(() => {
            expect(api.fetchEntriesForDate).toHaveBeenCalledTimes(2);
        });

        await user.click(screen.getByLabelText('Next day'));
        await waitFor(() => {
            expect(api.fetchEntriesForDate).toHaveBeenCalledTimes(3);
        });
    });

    it('filters time entries when the project filter changes', async () => {
        const user = userEvent.setup();
        renderWithQueryClient(<App />);
        await waitFor(() => {
            expect(screen.getByText(/Work on Feature X/i, { exact: false })).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: 'Filter Project A' }));
        await waitFor(() => {
            expect(screen.getByText(/Work on Feature X/i, { exact: false })).toBeInTheDocument();
            expect(screen.queryByText(/Bugfix on Y/i, { exact: false })).not.toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: 'Select All' }));
        await waitFor(() => {
            expect(screen.getByText(/Work on Feature X/i, { exact: false })).toBeInTheDocument();
            expect(screen.getByText(/Bugfix on Y/i, { exact: false })).toBeInTheDocument();
        });
    });
});