(function () {
    function applyTheme() {
        var stored = localStorage.getItem('skillloop_theme') || 'system';
        var dark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
    applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    window.addEventListener('storage', function (e) {
        if (e.key === 'skillloop_theme') applyTheme();
    });
})();