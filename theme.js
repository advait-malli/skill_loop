(function () {
    function applyTheme() {
        var stored = localStorage.getItem('skillloop_theme') || 'system';
        var dark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        swapLogos(dark);
    }

    function swapLogos(dark) {
        var suffix = dark ? 'dark' : 'light';
        document.querySelectorAll('img[data-theme-logo]').forEach(function (img) {
            var file = img.getAttribute('data-theme-logo');
            img.src = 'assets/' + file + '-' + suffix + '.png';
        });
    }

    applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    window.addEventListener('storage', function (e) {
        if (e.key === 'skillloop_theme') applyTheme();
    });
    new MutationObserver(function () {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        swapLogos(dark);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            var dark = document.documentElement.getAttribute('data-theme') === 'dark';
            swapLogos(dark);
        });
    }
})();