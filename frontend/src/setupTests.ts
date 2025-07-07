import '@testing-library/jest-dom';

// Mock window.matchMedia for Mantine and other UI libs
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => { },
        removeListener: () => { },
        addEventListener: () => { },
        removeEventListener: () => { },
        dispatchEvent: () => false,
    }),
});

// Mock ResizeObserver for Mantine's ScrollArea component.
// jsdom, the test environment, doesn't implement this browser API.
// This mock prevents "ResizeObserver is not defined" errors during tests.
class ResizeObserver {
    observe() {
        // do nothing
    }
    unobserve() {
        // do nothing
    }
    disconnect() {
        // do nothing
    }
}

window.ResizeObserver = ResizeObserver;