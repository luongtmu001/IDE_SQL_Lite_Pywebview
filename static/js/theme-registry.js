// ── Theme Registry & Definitions ─────────────────────────────────────────────
// Tập trung danh sách các Theme có sẵn trong hệ thống.
// Đã tích hợp các theme custom trích xuất từ VS Code .vsix:
// - Windows NT (Classic Workstation)
// - Windows XP (Luna Blue)

(function (global) {
    'use strict';

    const AVAILABLE_THEMES = [
        {
            id: 'dark',
            name: 'Dark Mode',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#202228',
            titlebarText: '#c7cfcf',
            border: '#3c3f41'
        },
        {
            id: 'light',
            name: 'Light Mode',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#dcdcdc',
            titlebarText: '#2b2b2b',
            border: '#cccccc'
        },
        {
            id: 'win-nt',
            name: 'Windows NT (Classic)',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#000080',
            titlebarText: '#FFFFFF',
            border: '#777777'
        },
        {
            id: 'win-xp',
            name: 'Windows XP (Luna)',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#0055ea',
            titlebarText: '#FFFFFF',
            border: '#2157d7'
        },
        {
            id: 'monokai',
            name: 'Monokai',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#1E1F1C',
            titlebarText: '#F8F8F2',
            border: '#3E3D32'
        },
        {
            id: 'nord',
            name: 'Nord',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#242933',
            titlebarText: '#ECEFF4',
            border: '#4C566A'
        },
        {
            id: 'tokyo-night-dark',
            name: 'Tokyo Night (Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#16161e',
            titlebarText: '#787c99',
            border: '#101014'
        },
        {
            id: 'tokyo-night-storm-dark',
            name: 'Tokyo Night Storm (Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#1f2335',
            titlebarText: '#8089b3',
            border: '#1b1e2e'
        },
        {
            id: 'tokyo-night-light',
            name: 'Tokyo Night (Light)',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#d6d8df',
            titlebarText: '#363c4d',
            border: '#c1c2c7'
        },
        {
            id: 'github-light-default-light',
            name: 'GitHub Light Default (Light)',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#ffffff',
            titlebarText: '#656d76',
            border: '#d0d7de'
        },
        {
            id: 'github-light-high-contrast-light',
            name: 'GitHub Light High Contrast (Light)',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#ffffff',
            titlebarText: '#0e1116',
            border: '#20252c'
        },
        {
            id: 'github-light-colorblind-beta-light',
            name: 'GitHub Light Colorblind (Beta) (Light)',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#ffffff',
            titlebarText: '#57606a',
            border: '#d0d7de'
        },
        {
            id: 'github-dark-default-dark',
            name: 'GitHub Dark Default (Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#0d1117',
            titlebarText: '#7d8590',
            border: '#30363d'
        },
        {
            id: 'github-dark-high-contrast-dark',
            name: 'GitHub Dark High Contrast (Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#0a0c10',
            titlebarText: '#f0f3f6',
            border: '#7a828e'
        },
        {
            id: 'github-dark-colorblind-beta-dark',
            name: 'GitHub Dark Colorblind (Beta) (Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#0d1117',
            titlebarText: '#8b949e',
            border: '#30363d'
        },
        {
            id: 'github-dark-dimmed-dark',
            name: 'GitHub Dark Dimmed (Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#22272e',
            titlebarText: '#768390',
            border: '#444c56'
        },
        {
            id: 'github-light',
            name: 'GitHub (Light)',
            isDark: false,
            cmTheme: 'default',
            titlebarBg: '#fff',
            titlebarText: '#2f363d',
            border: '#e1e4e8'
        },
        {
            id: 'github-dark',
            name: 'GitHub (Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#24292e',
            titlebarText: '#e1e4e8',
            border: '#1b1f23'
        },
        {
            id: 'synthwave-84',
            name: 'SynthWave 84',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#241b2f',
            titlebarText: '#ffffff',
            border: '#241b2f00'
        },
        {
            id: 'palenight-theme',
            name: 'Palenight Theme',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#292d3e',
            titlebarText: '#eeefff',
            border: '#282B3C'
        },
        {
            id: 'palenight-italic',
            name: 'Palenight Italic',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#292d3e',
            titlebarText: '#eeefff',
            border: '#282B3C'
        },
        {
            id: 'palenight-operator',
            name: 'Palenight Operator',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#292d3e',
            titlebarText: '#eeefff',
            border: '#282B3C'
        },
        {
            id: 'palenight-mild-contrast',
            name: 'Palenight (Mild Contrast)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#25293A',
            titlebarText: '#eeefff',
            border: '#2C2F40'
        },
        {
            id: 'shades-of-purple',
            name: 'Shades of Purple',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#1E1E3F',
            titlebarText: '#FFFFFF',
            border: '#25254B'
        },
        {
            id: 'shades-of-purple-super-dark',
            name: 'Shades of Purple (Super Dark)',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#15152b',
            titlebarText: '#FFFFFF',
            border: '#1a1a35'
        },
        {
            id: 'cobalt2',
            name: 'Cobalt2',
            isDark: true,
            cmTheme: 'darcula',
            titlebarBg: '#15232D',
            titlebarText: '#ffffff',
            border: '#0d3a58'
        },
    ];

    function getThemeById(id) {
        return AVAILABLE_THEMES.find(t => t.id === id) || AVAILABLE_THEMES[0];
    }

    function getAllThemes() {
        return AVAILABLE_THEMES;
    }

    function registerTheme(theme) {
        if (!theme || !theme.id) return false;
        const idx = AVAILABLE_THEMES.findIndex(t => t.id === theme.id);
        if (idx >= 0) {
            AVAILABLE_THEMES[idx] = theme;
        } else {
            AVAILABLE_THEMES.push(theme);
        }
        return true;
    }

    global.ThemeRegistry = {
        AVAILABLE_THEMES,
        getThemeById,
        getAllThemes,
        registerTheme
    };
})(window);
