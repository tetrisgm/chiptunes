# Bundled games

These directories are source modules compiled directly into Chiptunes.app.
They are not installable packs or an extension API.

The fixed roster is declared in `build.js`. Each retained game currently keeps
its existing source split (`definition`, `behavior`, `reactions`, `renderer`,
and `index`) so game behavior stays stable while the surrounding platform
machinery is removed.

Two earlier packs were intentionally excluded.
