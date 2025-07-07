// Mock marked module
vi.mock('marked', () => ({
    marked: (md: string) => {
        // Handle empty/null/undefined content
        if (md === undefined || md === null || md === '') {
            return '';
        }

        // Handle whitespace-only content
        if (!md.trim()) {
            return '';
        }

        // Simple markdown to HTML conversion for tests
        let html = md;

        // Convert headers first (before splitting into paragraphs)
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

        // Split by double newlines for paragraphs
        const paragraphs = html.split('\n\n');

        // Wrap non-header content in <p> tags
        html = paragraphs.map(p => {
            p = p.trim();
            if (!p) return '';
            // Don't wrap if it's already an HTML tag
            if (p.startsWith('<h1>') || p.startsWith('<h2>')) {
                return p;
            }
            // Handle list items
            if (p.includes('\n-')) {
                return p; // Keep lists as-is for simplicity
            }
            return `<p>${p}</p>`;
        }).filter(p => p).join('');

        return html;
    },
}));

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { DailyNoteEditor } from './DailyNoteEditor';
import * as api from './api';

// Mock the API module
vi.mock('./api.ts', () => ({
    fetchDailyNote: vi.fn(),
    upsertDailyNote: vi.fn(),
}));


// Test setup
const createTestQueryClient = () => new QueryClient({
    defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
    },
});

function renderDailyNoteEditor(date?: Date) {
    const testDate = date || new Date('2025-01-15T12:00:00Z');
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MantineProvider>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </MantineProvider>
    );
    return {
        ...render(<DailyNoteEditor date={testDate} />, { wrapper }),
        queryClient
    };
}

describe('DailyNoteEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set a fixed date for consistent testing
        vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

        // Default mock - no existing note
        vi.mocked(api.fetchDailyNote).mockResolvedValue(null);
        vi.mocked(api.upsertDailyNote).mockResolvedValue({
            id: 1,
            date: '2025-01-15',
            note_content: 'Saved content',
            created_at: '2025-01-15T10:00:00Z',
            updated_at: '2025-01-15T10:00:00Z',
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('Component Rendering', () => {
        it('renders with collapsed state by default', () => {
            renderDailyNoteEditor();

            // The toggle header should always be present
            expect(screen.getByText('Daily Notes')).toBeInTheDocument();

            // Check if the content is hidden by looking for aria-hidden on the collapse div
            const collapseDiv = screen.getByText('Daily Notes')
                .closest('.mantine-Card-root')
                ?.querySelector('[aria-hidden]');

            expect(collapseDiv).toHaveAttribute('aria-hidden', 'true');
        });

        it('expands when header is clicked', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            const header = screen.getByText('Daily Notes').closest('div')!;
            await user.click(header);

            // Wait for the content to be visible
            await waitFor(() => {
                expect(screen.getByPlaceholderText(/Write your daily notes/)).toBeInTheDocument();
            });

            // Check aria-hidden is now false
            const collapseDiv = screen.getByText('Daily Notes')
                .closest('.mantine-Card-root')
                ?.querySelector('[aria-hidden]');

            expect(collapseDiv).toHaveAttribute('aria-hidden', 'false');
        });
    });

    describe('Loading Existing Notes', () => {
        it('loads and displays existing note content', async () => {
            const existingNote = {
                id: 1,
                date: '2025-01-15',
                note_content: '# Existing Note\n\nThis is my note.',
                created_at: '2025-01-15T08:00:00Z',
                updated_at: '2025-01-15T09:00:00Z',
            };
            vi.mocked(api.fetchDailyNote).mockResolvedValue(existingNote);

            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));

            await waitFor(() => {
                const textarea = screen.getByPlaceholderText(/Write your daily notes/) as HTMLTextAreaElement;
                expect(textarea.value).toBe('# Existing Note\n\nThis is my note.');
            });

            // Should show saved timestamp - look for any time format
            expect(screen.getByText(/Saved/)).toBeInTheDocument();
        });

        it('shows default template for new notes', async () => {
            const user = userEvent.setup();
            const testDate = new Date('2025-01-15T12:00:00Z');
            renderDailyNoteEditor(testDate);

            await user.click(screen.getByText('Daily Notes'));

            await waitFor(() => {
                const textarea = screen.getByPlaceholderText(/Write your daily notes/) as HTMLTextAreaElement;
                // The date might be formatted based on local timezone
                expect(textarea.value).toContain('# Daily Notes - ');
                expect(textarea.value).toContain('## Tasks');
                expect(textarea.value).toContain('## Notes');
            });
        });
    });

    describe('Editing and Saving', () => {
        it('detects unsaved changes', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));
            const textarea = await screen.findByPlaceholderText(/Write your daily notes/);

            await user.type(textarea, 'New content');

            expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
            expect(screen.queryByText(/Saved/)).not.toBeInTheDocument();
        });

        it('saves content when Save button is clicked', async () => {
            const user = userEvent.setup();
            const testDate = new Date('2025-01-15T12:00:00Z');
            renderDailyNoteEditor(testDate);

            await user.click(screen.getByText('Daily Notes'));
            const textarea = await screen.findByPlaceholderText(/Write your daily notes/);

            await user.clear(textarea);
            await user.type(textarea, 'My new note content');

            const saveButton = screen.getByRole('button', { name: 'Save' });
            await user.click(saveButton);

            await waitFor(() => {
                expect(api.upsertDailyNote).toHaveBeenCalledWith(
                    expect.any(String), // Date string format might vary
                    'My new note content'
                );
            });

            // Should show saved state after successful save
            expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
        });

        it('disables save button when content is empty', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));
            const textarea = await screen.findByPlaceholderText(/Write your daily notes/);

            await user.clear(textarea);

            const saveButton = screen.getByRole('button', { name: 'Save' });
            expect(saveButton).toBeDisabled();
        });

        it('saves with keyboard shortcut Cmd+S', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));
            const textarea = await screen.findByPlaceholderText(/Write your daily notes/);

            await user.type(textarea, 'Content to save');

            // Focus the textarea and trigger Cmd+S
            textarea.focus();
            fireEvent.keyDown(window, { key: 's', metaKey: true });

            await waitFor(() => {
                expect(api.upsertDailyNote).toHaveBeenCalled();
            });
        });

        it('saves with keyboard shortcut Ctrl+S', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));
            const textarea = await screen.findByPlaceholderText(/Write your daily notes/);

            await user.type(textarea, 'Content to save');

            // Focus the textarea and trigger Ctrl+S
            textarea.focus();
            fireEvent.keyDown(window, { key: 's', ctrlKey: true });

            await waitFor(() => {
                expect(api.upsertDailyNote).toHaveBeenCalled();
            });
        });
    });

    describe('Preview Mode', () => {
        it('switches between edit and preview', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            // First expand the component
            const header = screen.getByText('Daily Notes').closest('div')!;
            await user.click(header);

            // Wait for it to be ready
            await waitFor(() => {
                expect(screen.getByPlaceholderText(/write your daily notes/i)).toBeInTheDocument();
            });

            // Verify we're in edit mode
            const editButton = screen.getByRole('button', { name: /edit/i });
            const previewButton = screen.getByRole('button', { name: /preview/i });
            expect(editButton).toHaveAttribute('data-variant', 'filled');
            expect(previewButton).toHaveAttribute('data-variant', 'light');

            // Switch to Preview
            await user.click(previewButton);

            // Wait for mode switch - textarea should disappear
            await waitFor(() => {
                expect(screen.queryByPlaceholderText(/write your daily notes/i)).not.toBeInTheDocument();
            });

            // Verify button states have switched
            expect(editButton).toHaveAttribute('data-variant', 'light');
            expect(previewButton).toHaveAttribute('data-variant', 'filled');

            // Switch back to Edit
            await user.click(editButton);

            // Wait for edit mode
            await waitFor(() => {
                expect(screen.getByPlaceholderText(/write your daily notes/i)).toBeInTheDocument();
            });

            // Verify button states
            expect(editButton).toHaveAttribute('data-variant', 'filled');
            expect(previewButton).toHaveAttribute('data-variant', 'light');
        });

        it('shows empty state in preview when no content', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            // Expand first
            const header = screen.getByText('Daily Notes').closest('div')!;
            await user.click(header);

            await waitFor(() => {
                expect(screen.getByPlaceholderText(/write your daily notes/i)).toBeInTheDocument();
            });

            // Empty the textarea
            const textarea = screen.getByPlaceholderText(/write your daily notes/i);
            await user.clear(textarea);

            // Verify textarea is empty
            expect(textarea).toHaveValue('');

            // Preview
            await user.click(screen.getByRole('button', { name: /preview/i }));

            // Wait for preview to render with empty state message
            await waitFor(() => {
                // The component adds "Nothing to preview" when marked returns empty
                const emptyMessage = screen.getByText('Nothing to preview');
                expect(emptyMessage).toBeInTheDocument();
            });
        });

        it('does not save in preview mode with shortcut', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            // Expand first
            const header = screen.getByText('Daily Notes').closest('div')!;
            await user.click(header);

            await waitFor(() => {
                expect(screen.getByPlaceholderText(/write your daily notes/i)).toBeInTheDocument();
            });

            // Add some content first
            const textarea = screen.getByPlaceholderText(/write your daily notes/i);
            await user.clear(textarea);
            await user.type(textarea, 'Some content to save');

            // Preview mode
            await user.click(screen.getByRole('button', { name: /preview/i }));

            // Wait for preview mode to be active (textarea should be gone)
            await waitFor(() => {
                expect(screen.queryByPlaceholderText(/write your daily notes/i)).not.toBeInTheDocument();
            });

            // Verify we're in preview mode
            const previewButton = screen.getByRole('button', { name: /preview/i });
            expect(previewButton).toHaveAttribute('data-variant', 'filled');

            // Clear any previous calls to ensure clean test
            vi.mocked(api.upsertDailyNote).mockClear();

            // Press Cmd/Ctrl+S
            fireEvent.keyDown(window, { key: 's', metaKey: true });
            fireEvent.keyDown(window, { key: 's', ctrlKey: true });

            // Give it a moment to ensure the save would have been triggered if it was going to
            await new Promise(resolve => setTimeout(resolve, 200));

            // Should not save in preview mode
            expect(api.upsertDailyNote).not.toHaveBeenCalled();
        });
    });

    describe('Export Functionality', () => {
        it('exports note as markdown file', async () => {
            // Mock URL methods
            const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
            const mockRevokeObjectURL = vi.fn();
            global.URL.createObjectURL = mockCreateObjectURL;
            global.URL.revokeObjectURL = mockRevokeObjectURL;

            // Mock document.createElement to return a proper anchor element
            const mockClick = vi.fn();
            const mockAnchor = document.createElement('a');
            mockAnchor.click = mockClick;
            const realCreate = document.createElement.bind(document);
            vi.spyOn(document, 'createElement').mockImplementation(tag => {
                if (tag === 'a') return mockAnchor;
                return realCreate(tag);
            });


            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));
            const textarea = await screen.findByPlaceholderText(/Write your daily notes/);
            await user.type(textarea, '# Export Test\n\nThis should be exported.');

            const exportButton = screen.getByRole('button', { name: 'Export' });
            await user.click(exportButton);

            expect(mockCreateObjectURL).toHaveBeenCalled();
            expect(mockAnchor.download).toContain('daily-note-');
            expect(mockAnchor.download).toContain('.md');
            expect(mockClick).toHaveBeenCalled();
            expect(mockRevokeObjectURL).toHaveBeenCalled();
        });
    });

    describe('Character Counter', () => {
        it('displays character count', async () => {
            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));

            await waitFor(() => {
                expect(screen.getByPlaceholderText(/Write your daily notes/)).toBeInTheDocument();
            });

            const textarea = screen.getByPlaceholderText(/Write your daily notes/);

            // Clear and type new content
            await user.clear(textarea);
            await user.type(textarea, 'Hello');

            await waitFor(() => {
                expect(screen.getByText('5 characters')).toBeInTheDocument();
            });
        });
    });

    describe('Error Handling', () => {
        it('handles save errors gracefully', async () => {
            vi.mocked(api.upsertDailyNote).mockRejectedValue(new Error('Save failed'));

            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));

            await waitFor(() => {
                expect(screen.getByPlaceholderText(/Write your daily notes/)).toBeInTheDocument();
            });

            const textarea = screen.getByPlaceholderText(/Write your daily notes/);
            await user.type(textarea, 'Content');

            await user.click(screen.getByRole('button', { name: 'Save' }));

            // The component should handle the error without crashing
            await waitFor(() => {
                expect(api.upsertDailyNote).toHaveBeenCalled();
            });

            // Content should still be editable
            expect(textarea).toBeInTheDocument();
        });

        it('disables textarea while loading', async () => {
            // Make the fetch take longer
            let resolvePromise: (value: any) => void;
            const delayedPromise = new Promise((resolve) => {
                resolvePromise = resolve;
            });
            vi.mocked(api.fetchDailyNote).mockReturnValue(delayedPromise as any);

            const user = userEvent.setup();
            renderDailyNoteEditor();

            await user.click(screen.getByText('Daily Notes'));

            // Initially, the textarea should be disabled while loading
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText(/Write your daily notes/);
                expect(textarea).toBeDisabled();
            });

            // Resolve the promise
            resolvePromise!(null);

            // After loading, textarea should be enabled
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText(/Write your daily notes/);
                expect(textarea).not.toBeDisabled();
            });
        });
    });

    describe('Date Changes', () => {
        it('updates content when date prop changes', async () => {
            const { rerender } = renderDailyNoteEditor(new Date('2025-01-15T12:00:00Z'));
            const user = userEvent.setup();

            await user.click(screen.getByText('Daily Notes'));

            await waitFor(() => {
                const textarea = screen.getByPlaceholderText(/Write your daily notes/) as HTMLTextAreaElement;
                expect(textarea.value).toContain('Daily Notes');
            });

            // Change date by re-rendering with new props
            const newDate = new Date('2025-01-16T12:00:00Z');
            const queryClient = createTestQueryClient();
            rerender(
                <MantineProvider>
                    <QueryClientProvider client={queryClient}>
                        <DailyNoteEditor date={newDate} />
                    </QueryClientProvider>
                </MantineProvider>
            );

            await waitFor(() => {
                // The content should update to reflect the new date
                expect(api.fetchDailyNote).toHaveBeenCalledWith('2025-01-16');
            });
        });
    });
});