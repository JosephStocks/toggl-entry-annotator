import { useState, useEffect } from 'react';
import {
    Checkbox,
    Title,
    Card,
    Text,
    Group,
    Button,
    Collapse,
    ActionIcon,
    Box,
} from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';

// --- API Helper ----------------------------------------
const API_BASE = '/api';

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, options);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `HTTP ${response.status} ${response.statusText}: ${errorBody}`
        );
    }
    return response.json();
}

const fetchProjects = () => fetchApi<string[]>('/projects');

// --- Component ----------------------------------------

interface ProjectFilterProps {
    onChange: (selectedProjects: Set<string>) => void;
}

export function ProjectFilter({ onChange }: ProjectFilterProps) {
    const [projects, setProjects] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const loadProjects = async () => {
            try {
                const projectList = await fetchProjects();
                setProjects(projectList);
                // Initially, all projects are selected
                const allProjects = new Set(projectList);
                setSelected(allProjects);
                onChange(allProjects);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load projects');
            }
        };
        loadProjects();
    }, [onChange]);

    const handleProjectToggle = (project: string, checked: boolean) => {
        const newSelected = new Set(selected);
        if (checked) {
            newSelected.add(project);
        } else {
            newSelected.delete(project);
        }
        setSelected(newSelected);
        onChange(newSelected);
    };

    const handleToggleAll = () => {
        if (selected.size === projects.length) {
            // Deselect all
            setSelected(new Set());
            onChange(new Set());
        } else {
            // Select all
            const allProjects = new Set(projects);
            setSelected(allProjects);
            onChange(allProjects);
        }
    };

    const allProjectsSelected = projects.length > 0 && selected.size === projects.length;

    if (error) {
        return <Text color="red">Error loading projects: {error}</Text>;
    }

    return (
        <Card withBorder shadow="sm" p={0}>
            <Box
                onClick={() => setIsOpen(o => !o)}
                style={{ cursor: 'pointer' }}
                py="sm"
                px="md"
            >
                <Group justify="space-between">
                    <Title order={4} m={0}>Filter by Project</Title>
                    <ActionIcon variant="subtle" color="gray">
                        {isOpen ? <IconChevronUp size={20} /> : <IconChevronDown size={20} />}
                    </ActionIcon>
                </Group>
            </Box>
            <Collapse in={isOpen}>
                <Box px="md" pb="md">
                    {projects.length > 0 &&
                        <Button
                            variant="subtle"
                            size="sm"
                            onClick={handleToggleAll}
                            fullWidth
                            mb="xs"
                        >
                            {allProjectsSelected ? 'Deselect all' : 'Select all'}
                        </Button>
                    }
                    {projects.length === 0 ? (
                        <Text size="sm" c="dimmed">No projects found to filter.</Text>
                    ) : (
                        projects.map(project => (
                            <Checkbox
                                key={project}
                                label={project}
                                checked={selected.has(project)}
                                onChange={e => handleProjectToggle(project, e.currentTarget.checked)}
                                styles={{ root: { marginBottom: 'var(--mantine-spacing-xs)' } }}
                            />
                        ))
                    )}
                </Box>
            </Collapse>
        </Card>
    );
} 