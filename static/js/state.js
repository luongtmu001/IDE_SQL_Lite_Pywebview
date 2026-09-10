export const state = {
    connections: [],
    tabs: [],
    activeTabId: null,
};

export function activeTab() {
    return (
        state.tabs.find(
            tab => tab.tabId === state.activeTabId
        ) || null
    );
}
