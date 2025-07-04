import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { vi } from 'vitest';

import { ProjectFilter } from './ProjectFilter';

// Helper to render with MantineProvider
function renderProjectFilter(onChange = vi.fn()) {
    return render(
        <MantineProvider>
            <ProjectFilter onChange={onChange} />
        </MantineProvider>
    );
}

// Helper to mock the projects API endpoint
function mockProjectsApi(projects: string[], ok = true) {
    window.fetch = vi.fn().mockResolvedValue({
        ok,
        json: async () => projects,
    }) as any;
}


describe('ProjectFilter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders a loading or initial state correctly', async () => {
        mockProjectsApi([]);
        renderProjectFilter();
        // The component will fetch and settle on an empty state.
        // Waiting for the final message ensures all state updates are complete.
        await screen.findByText(/No projects found to filter/i);
        expect(screen.getByText('Filter by Project')).toBeInTheDocument();
    });

    it('displays a list of projects as checkboxes', async () => {
        const projects = ['Project A', 'Project B'];
        mockProjectsApi(projects);
        renderProjectFilter();

        await waitFor(() => {
            expect(screen.getByLabelText('Project A')).toBeInTheDocument();
            expect(screen.getByLabelText('Project B')).toBeInTheDocument();
        });
    });

    it('calls onChange with all projects selected by default', async () => {
        const projects = ['Project A', 'Project B'];
        const onChange = vi.fn();
        mockProjectsApi(projects);
        renderProjectFilter(onChange);

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith(new Set(projects));
        });
    });

    it('calls onChange when a project is deselected', async () => {
        const projects = ['Project A', 'Project B'];
        const onChange = vi.fn();
        mockProjectsApi(projects);
        renderProjectFilter(onChange);

        await waitFor(() => {
            expect(screen.getByLabelText('Project A')).toBeChecked();
        });

        await userEvent.click(screen.getByLabelText('Project A'));

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith(new Set(['Project B']));
        });
    });

    it('shows a message when no projects are available', async () => {
        mockProjectsApi([]);
        renderProjectFilter();
        await screen.findByText(/No projects found to filter/i);
    });

    it('handles API error gracefully', async () => {
        window.fetch = vi.fn().mockRejectedValue(new Error('API Down'));
        renderProjectFilter();
        await screen.findByText(/Error loading projects: API Down/i);
    });
}); 