# Defunct WNBA franchise logos

ESPN serves no logo for these three franchises (its team records list none, and every `a.espncdn.com/i/teamlogos/wnba/`
path 404s; probed 2026-10-18). `teamLogoUrl` (`src/utils/league.ts`, `WNBA_HOSTED_LOGOS`) serves these files instead, for
light and dark alike.

The source is the league's own site: WNBA.com's 2002 player-bio team marks, as archived by the Wayback Machine. They are
the largest transparent copies found. ESPN's own copies survive on the Wayback Machine too
(`espn.go.com/i/teamlogos/wnba/med/cle.gif`, 80x80; `sml/mia.gif` and `sml/por.gif`, 50x50), but they are smaller and
sit on an opaque white background.

| File | ESPN id | Franchise | Seasons | Source (retrieved 2026-10-18) | Source sha256 (bytes) |
|---|---|---|---|---|---|
| `cle.png` | 2 | Cleveland Rockers | 1997-2003 | `https://web.archive.org/web/20020608210045id_/http://wnba.com:80/media/playerbio_logo_rockers.gif` | `dea374bc7968facd6362353dee51edea3c7e8ea7fa56834ec1a0a92899aa3006` (2,417) |
| `mia.png` | 7 | Miami Sol | 2000-2002 | `https://web.archive.org/web/20020608211703id_/http://wnba.com:80/media/playerbio_logo_sol.gif` | `7d72894e524faa5c0cc4b6d7ee3f027d9e0befdddaf2bc3288e5db1cf0c75893` (2,552) |
| `por-2000.png` | 12 | Portland Fire (2000-02) | 2000-2002 | `https://web.archive.org/web/20020819004233id_/http://wnba.com:80/media/playerbio_logo_fire.gif` | `c042a36ffcf5bbcdd454020510ee76b0e0fa32b67379a67216b54a5b875a1e8f` (2,219) |

Conversion: each 110x90 GIF was converted to RGBA PNG. The four opaque corner pixels (a layout marker from the original
page) were cleared, and the image was centred on a transparent 110x110 canvas so it stays square in the site's square logo
boxes. Nothing else was changed.

| File | sha256 | Bytes | Size |
|---|---|---|---|
| `cle.png` | `84ff83a96b0f3822a31ca871742c2e5040aa543f8689ebff195d6d1dae8e94f4` | 8,241 | 110x110 |
| `mia.png` | `32b4170fbde03048ad04bd39dc4e296f6f91c020ffa6cbf08475a311f5e19767` | 8,270 | 110x110 |
| `por-2000.png` | `77d65fe62b20309acf2b15f532bc842d3f4523cf3f5a38dba5fed96a4ff94294` | 5,984 | 110x110 |

ESPN's payloads list the 2000-02 Portland Fire under the 2026 Fire's id (132052). `wnbaLogoId`
(`src/nba/data/wnbaTeams.ts`) maps that id back to 12 for seasons through 2002, so those games draw `por-2000.png`.
