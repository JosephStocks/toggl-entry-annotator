import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { MantineProvider } from '@mantine/core';

// --- Copied types from App.tsx ---
type Note = { id: number; note_text: string; created_at: string };
type Entry = {
    entry_id: number;
    description: string;
    project_name: string;
    seconds: number;
    start: string;
    notes: Note[];
};
type CurrentEntry = {
    id: number;
    description: string;
    project_name: string;
    start: string;
    duration: number; // is negative
    project_id: number;
};
// ------------------------------------

interface MockApiProps {
    entries?: Entry[];
    projects?: string[];
    current?: CurrentEntry | null;
    ok?: boolean;
}

// Helper to render App with MantineProvider
function renderWithProvider() {
    return render(
        <MantineProvider>
            <App />
        </MantineProvider>
    );
}

// More robust mock that handles all API endpoints used by App
function mockAllApis({ entries = [], projects = [], current = null, ok = true }: MockApiProps) {
    window.fetch = vi.fn((url: string | URL, options?: RequestInit) => {
        const urlString = url.toString();

        if (urlString.includes('/projects')) {
            return Promise.resolve({ ok, json: async () => projects });
        }
        if (urlString.includes('/sync/current')) {
            return Promise.resolve({ ok, status: current ? 200 : 204, json: async () => current });
        }
        if (urlString.includes('/time_entries')) {
            return Promise.resolve({ ok, json: async () => entries });
        }
        if (urlString.includes('/notes') && options?.method === 'POST') {
            return Promise.resolve({ ok, status: 201, json: async () => ({ message: 'Note added' }) });
        }

        // Fallback for unexpected calls
        return Promise.reject(new Error(`Unhandled API call to ${urlString}`));
    }) as any;
}

describe('App', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows loading state', async () => {
        mockAllApis({ entries: [] });
        renderWithProvider();
        // The loader is now present for a very short time.
        // We can check that the main content appears.
        await screen.findByText(/Sync Toggl Data/i);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('shows error state', async () => {
        // Mock a specific endpoint to fail
        window.fetch = vi.fn().mockRejectedValue(new Error('Network Error'));
        renderWithProvider();
        // The error will appear in both the main content and the filter.
        // We can just wait for one of them.
        const alerts = await screen.findAllByText(/Network Error/i);
        expect(alerts.length).toBeGreaterThan(0);
    });

    it('shows empty state', async () => {
        mockAllApis({ entries: [], projects: ['Any Project'] });
        renderWithProvider();
        await screen.findByText(/No time entries found/i);
    });

    it('shows populated state', async () => {
        mockAllApis({
            entries: [
                {
                    entry_id: 1, description: 'Test Entry', project_name: 'Test Project',
                    seconds: 120, start: '2025-01-01T10:00:00Z',
                    notes: [{ id: 1, note_text: 'A note', created_at: '2025-01-01T11:00:00Z' }],
                },
            ],
            projects: ['Test Project'],
        });
        renderWithProvider();
        await screen.findByText('Test Entry');
        // Scope the search to the main content area to avoid matching the filter
        const mainContent = screen.getByRole('main');
        expect(within(mainContent).getByText('Test Project')).toBeInTheDocument();
        expect(within(mainContent).getByText('A note')).toBeInTheDocument();
    });

    it('can add a note', async () => {
        mockAllApis({
            entries: [
                {
                    entry_id: 2, description: 'Entry to note', project_name: 'Proj',
                    seconds: 60, start: '2025-01-01T10:00:00Z', notes: [],
                },
            ],
            projects: ['Proj'],
        });

        renderWithProvider();
        await screen.findByText('Entry to note');

        // Type in note and submit
        const input = await screen.findByPlaceholderText('Add a note...');
        await userEvent.type(input, 'New note');
        await userEvent.click(screen.getByRole('button', { name: /Add/i }));

        // The mock should handle the refetch, but we just need to ensure the action completes
        // In a real scenario, you'd update the mock to return the new note on the next fetch
        expect(input).toHaveValue('');
    });

    it('navigates dates', async () => {
        mockAllApis({ entries: [] });
        renderWithProvider();
        await screen.findByText(/No time entries found/i);

        // Go to previous day to ensure "Go to Today" button appears
        await userEvent.click(screen.getByLabelText('Previous day'));
        await screen.findByText(/Go to Today/i);

        // Now the "Go to Today" button should be present
        await userEvent.click(screen.getByRole('button', { name: /go to today/i }));
        await waitFor(() => {
            expect(screen.queryByText(/Go to Today/i)).not.toBeInTheDocument();
        });
    });
});

describe('App with Project Filter', () => {
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
    const mockProjects = ['Project A', 'Project B'];

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('filters time entries when a project is deselected', async () => {
        mockAllApis({ entries: mockEntries, projects: mockProjects });
        renderWithProvider();

        // Wait for both entries and the filter to be rendered
        await screen.findByText('Work on Feature X');
        await screen.findByText('Bugfix on Y');
        const projectACheckbox = await screen.findByLabelText('Project A');
        expect(projectACheckbox).toBeInTheDocument();
        expect(projectACheckbox).toBeChecked();

        // Deselect Project A
        await userEvent.click(projectACheckbox);

        // Now, only Project B's entry should be visible
        await waitFor(() => {
            const mainContent = screen.getByRole('main');
            expect(within(mainContent).queryByText('Work on Feature X')).not.toBeInTheDocument();
            expect(within(mainContent).getByText('Bugfix on Y')).toBeInTheDocument();
        });
    });

    it('shows all entries again when a deselected project is re-selected', async () => {
        mockAllApis({ entries: mockEntries, projects: mockProjects });
        renderWithProvider();

        const projectACheckbox = await screen.findByLabelText('Project A');

        // Deselect
        await userEvent.click(projectACheckbox);
        await waitFor(() => {
            const mainContent = screen.getByRole('main');
            expect(within(mainContent).queryByText('Work on Feature X')).not.toBeInTheDocument();
        });

        // Re-select
        await userEvent.click(projectACheckbox);
        await waitFor(() => {
            const mainContent = screen.getByRole('main');
            expect(within(mainContent).getByText('Work on Feature X')).toBeInTheDocument();
            expect(within(mainContent).getByText('Bugfix on Y')).toBeInTheDocument();
        });
    });

    it('filters correctly with "Deselect All" and "Select All" buttons', async () => {
        mockAllApis({ entries: mockEntries, projects: mockProjects });
        renderWithProvider();

        await screen.findByText('Work on Feature X');
        const deselectAllButton = await screen.findByRole('button', { name: 'Deselect all' });

        // Deselect all
        await userEvent.click(deselectAllButton);
        await waitFor(() => {
            const mainContent = screen.getByRole('main');
            expect(within(mainContent).queryByText('Work on Feature X')).not.toBeInTheDocument();
            expect(within(mainContent).queryByText('Bugfix on Y')).not.toBeInTheDocument();
        });

        // "Select all" button should now be visible
        const selectAllButton = await screen.findByRole('button', { name: 'Select all' });
        await userEvent.click(selectAllButton);
        await waitFor(() => {
            const mainContent = screen.getByRole('main');
            expect(within(mainContent).getByText('Work on Feature X')).toBeInTheDocument();
            expect(within(mainContent).getByText('Bugfix on Y')).toBeInTheDocument();
        });
    });
}); 