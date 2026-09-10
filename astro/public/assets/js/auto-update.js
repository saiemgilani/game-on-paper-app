// Auto-refresh for live pages, visibility-aware: a visible tab reloads on the
// usual cadence (with jitter so a stadium of open tabs doesn't stampede the
// edge in the same second); a hidden tab never reloads on a timer -- its
// refresh is deferred to the moment it is next seen, so backgrounded tabs stop
// re-fetching a page nobody is reading.
(function () {
    var INTERVAL_MS = 60 * 1000;
    var JITTER_MS = Math.random() * 6000;
    var due = false;
    setTimeout(function () {
        if (document.visibilityState === "visible") {
            location.reload();
        } else {
            due = true;
        }
    }, INTERVAL_MS + JITTER_MS);
    document.addEventListener("visibilitychange", function () {
        if (due && document.visibilityState === "visible") {
            location.reload();
        }
    });
})();
