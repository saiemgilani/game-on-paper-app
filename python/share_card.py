"""The 1200x630 card a game link previews with: pregame, live or final.

`variant="spoilerfree"` draws the matchup, the date, Final or Live and three
direction-free excitement numbers (excitement.py) in place of the score, the WP
line and Deserved Win %. A pregame card has nothing to spoil, so both variants
draw the same pregame card.

Colors are the teams' own ESPN colors plus neutrals from matplotlib's default
style; the type is Chivo, the site's font (assets/fonts, copied from
astro/public/assets/fonts/chivo).
"""

import io
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from matplotlib import rcParamsDefault
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.colors import TABLEAU_COLORS, to_rgb
from matplotlib.figure import Figure
from matplotlib.font_manager import FontProperties
from matplotlib.patches import Rectangle
from PIL import Image, ImageOps

import excitement

STATES = ("pre", "live", "final")
VARIANTS = ("full", "spoilerfree")

W, H, DPI, PAD = 1200, 630, 100, 48
ET = ZoneInfo("America/New_York")
_FONTS = Path(__file__).parent / "assets" / "fonts"
BOLD = FontProperties(fname=_FONTS / "Chivo-Bold.ttf")
REGULAR = FontProperties(fname=_FONTS / "Chivo-Regular.ttf")
PAPER = rcParamsDefault["figure.facecolor"]
INK = rcParamsDefault["text.color"]
MUTED = TABLEAU_COLORS["tab:gray"]
RULE = rcParamsDefault["grid.color"]
# astro/src/utils/constants.ts MEME_LIST: the site prints this team in lowercase
MEME_TEAM_IDS = {"61"}


def _color(team):
    """The team's color when it reads on the white card, else its alternate, else ink."""
    for key in ("color", "alternateColor"):
        hexv = team.get(key) or ""
        if len(hexv) == 6:
            r, g, b = to_rgb("#" + hexv)
            if 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.8:
                return "#" + hexv
    return INK


def _side(comp, home_away):
    c = next(x for x in comp["competitors"] if x.get("homeAway") == home_away)
    t = c["team"]
    lower = str(t.get("id")) in MEME_TEAM_IDS
    clean = (lambda s: (s or "").lower()) if lower else (lambda s: s or "")
    rank = c.get("rank") or (c.get("curatedRank") or {}).get("current")
    records = c.get("record") or c.get("records") or []
    return {
        "id": str(t.get("id")),
        "name": clean(t.get("location") or t.get("displayName")),
        "abbr": clean(t.get("abbreviation")),
        "score": c.get("score"),
        "color": _color(t),
        "rank": rank if isinstance(rank, int) and 0 < rank <= 25 else None,
        "record": next(
            (r.get("summary") for r in records if r.get("type") in ("total", None)),
            None,
        ),
        "winner": c.get("winner"),
    }


def _result(home, away):
    """The home side's final WP: 1 if it won, 0 if it lost, 0.5 for a tie."""
    try:
        margin = int(home["score"]) - int(away["score"])
    except (TypeError, ValueError):
        margin = bool(home["winner"]) - bool(away["winner"])
    return 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5


def _clock12(d):
    return f"{d.hour % 12 or 12}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}"


def _kickoff(comp):
    try:
        return datetime.fromisoformat(comp["date"].replace("Z", "+00:00")).astimezone(
            ET
        )
    except (KeyError, ValueError, AttributeError):
        return None


def _live_clock(status):
    name = (status.get("type") or {}).get("name") or ""
    period = int(status.get("period") or 0)
    q = f"Q{period}" if period <= 4 else ("OT" if period == 5 else f"{period - 4}OT")
    if "HALFTIME" in name:
        return "Halftime"
    if "END_PERIOD" in name:
        return f"End of {q}"
    return f"{q} {status.get('displayClock') or ''}".strip()


class _Card:
    def __init__(self, drawn):
        self.fig = Figure(figsize=(W / DPI, H / DPI), dpi=DPI, facecolor=PAPER)
        self.renderer = FigureCanvasAgg(self.fig).get_renderer()
        self.drawn = drawn

    def text(
        self,
        x,
        y,
        s,
        px,
        font=REGULAR,
        color=INK,
        ha="center",
        va="baseline",
        max_w=None,
    ):
        """`s` at pixel (x, y) from the top left, `px` tall, shrunk until it fits `max_w`."""
        t = self.fig.text(
            x / W, 1 - y / H, s, fontproperties=font, color=color, ha=ha, va=va
        )
        t.set_fontsize(px * 72 / DPI)
        while max_w and px > 16 and t.get_window_extent(self.renderer).width > max_w:
            px -= 2
            t.set_fontsize(px * 72 / DPI)
        if self.drawn is not None:
            self.drawn.append(s)

    def logo(self, team, league, logo_fetch, cx, cy, size):
        # the art the Worker chose (GOP's own where the site overrides ESPN's), else ESPN's
        url = team.get("logo") or f"https://a.espncdn.com/i/teamlogos/{league if league in ('nfl', 'nba', 'wnba') else 'ncaa'}/500/{team['id']}.png"
        img = None
        raw = logo_fetch(url)
        if raw:
            try:
                img = Image.open(io.BytesIO(raw)).convert("RGBA")
                # fit the box both ways: the site's own art can be smaller (UGA's is 96px)
                img = ImageOps.contain(img, (size, size), Image.LANCZOS)
            except Exception:
                img = None
        if img is None:  # no logo: the abbreviation, in the team's color
            self.text(
                cx, cy, team["abbr"], size * 0.32, BOLD, team["color"], va="center"
            )
            return
        self.fig.figimage(
            np.asarray(img),
            xo=int(cx - img.width / 2),
            yo=int(H - cy - img.height / 2),
            zorder=3,
        )

    def wp(self, plays, home, away, completed, elapsed, top, bottom):
        """The home side's win probability over the plays so far, like the page's WP chart."""
        plays = [p for p in plays if p.get("scrimmage_play")] or plays
        pts = []
        for p in plays:
            before = (p.get("winProbability") or {}).get("before")
            if before is not None:
                pts.append(
                    (
                        int(p.get("period") or 0),
                        before if str(p.get("pos_team")) == home["id"] else 1 - before,
                    )
                )
        if pts and completed:
            # the result, like the page's chart: 1 or 0 for the home side, 0.5 for a tie
            # (ESPN marks neither side the winner then)
            pts.append((pts[-1][0], _result(home, away)))
        elif pts:
            # live: the newest play's own swing, so the line is not a play behind
            after = (plays[-1].get("winProbability") or {}).get("after")
            if after is not None:
                pts.append((pts[-1][0], after if str(plays[-1].get("pos_team")) == home["id"] else 1 - after))
        self.line(pts, home, away, elapsed, top, bottom, lambda period: f"Q{period}" if period <= 4 else "OT")

    def line(self, pts, home, away, elapsed, top, bottom, label_of):
        """The home side's WP line over `pts` ((period, home WP) per play), a rule and label at each new period."""
        ax = self.fig.add_axes(
            [PAD / W, 1 - bottom / H, (W - 2 * PAD) / W, (bottom - top) / H]
        )
        ax.set_axis_off()
        n = len(pts)
        # live: the axis spans the whole game, so the line stops where the game is
        ax.set_xlim(0, max(1, (n - 1) / max(elapsed, 0.1)))
        ax.set_ylim(0, 1)
        ax.axhline(0.5, color=RULE, lw=1.5, ls=(0, (4, 4)))
        seen = set()
        for i, (period, _) in enumerate(pts):
            label = label_of(period)
            if i and period > pts[i - 1][0] and label not in seen and period >= 2:
                seen.add(label)
                ax.axvline(i, color=RULE, lw=1)
                ax.text(
                    i + 1,
                    0.97,
                    label,
                    va="top",
                    color=MUTED,
                    fontproperties=REGULAR,
                    fontsize=16 * 72 / DPI,
                )
                if self.drawn is not None:
                    self.drawn.append(label)
        if n:
            xs = np.arange(n)
            ys = np.array([y for _, y in pts])
            ax.fill_between(
                xs,
                ys,
                0.5,
                where=ys >= 0.5,
                interpolate=True,
                color=home["color"],
                alpha=0.35,
                lw=0,
            )
            ax.fill_between(
                xs,
                ys,
                0.5,
                where=ys <= 0.5,
                interpolate=True,
                color=away["color"],
                alpha=0.35,
                lw=0,
            )
            # the line in the leader's color, like the page's chart (resources/chart.ts):
            # home above 50%, away below, each half clipped to its side of the even line
            for team, y0 in ((home, 0.5), (away, 0.0)):
                (line,) = ax.plot(xs, ys, color=team["color"], lw=2.5, solid_capstyle="round")
                line.set_clip_path(Rectangle((0, y0), 1, 0.5, transform=ax.transAxes))
        for team, y, va in ((home, 0.97, "top"), (away, 0.03, "bottom")):
            ax.text(
                0.005,
                y,
                team["abbr"],
                transform=ax.transAxes,
                va=va,
                color=team["color"],
                fontproperties=BOLD,
                fontsize=22 * 72 / DPI,
            )
            if self.drawn is not None:
                self.drawn.append(team["abbr"])

    def png(self):
        buf = io.BytesIO()
        self.fig.savefig(buf, format="png", dpi=DPI, facecolor=PAPER)
        return buf.getvalue()


def _elapsed(status):
    """Share of regulation played, from the live status (1 once overtime starts)."""
    period = int(status.get("period") or 1)
    if period > 4:
        return 1.0
    try:
        m, s = (status.get("displayClock") or "15:00").split(":")
        left = int(m) * 60 + int(float(s))
    except ValueError:
        left = 900
    return min(1.0, ((period - 1) * 900 + 900 - left) / 3600)


def render(
    game: dict,
    league: str,
    state: str,
    variant: str,
    logo_fetch,
    now: datetime,
    drawn: list | None = None,
) -> bytes:
    """The card as PNG bytes. `drawn`, when given, collects every string drawn on it."""
    if state not in STATES or variant not in VARIANTS:
        raise ValueError(f"state {state!r} / variant {variant!r}")
    header = game["header"]
    comp = header["competitions"][0]
    status = comp.get("status") or {}
    home, away = _side(comp, "home"), _side(comp, "away")
    for side, team in (("home", home), ("away", away)):
        team["logo"] = (game.get("logos") or {}).get(side)
    kickoff = _kickoff(comp)
    context = (header.get("gameNote") or "").strip() or (
        f"Week {header['week']}" if header.get("week") else ""
    )
    day = f"{kickoff:%b} {kickoff.day}, {kickoff.year}" if kickoff else ""
    asof = f"as of {_clock12(now.astimezone(ET))} ET"
    spoilerfree = variant == "spoilerfree"
    card = _Card(drawn)

    if state == "pre":
        when = f"{kickoff:%a}, {kickoff:%b} {kickoff.day}" if kickoff else ""
        if kickoff and comp.get("timeValid") is not False:
            when += f", {_clock12(kickoff)} ET"
        tv = next(
            (
                b.get("media", {}).get("shortName")
                for b in comp.get("broadcasts") or []
                if b.get("media")
            ),
            None,
        )
        card.text(
            W / 2,
            58,
            " / ".join(x for x in (context, when, tv) if x),
            26,
            color=MUTED,
            max_w=W - 2 * PAD,
        )
        named = [
            f"#{t['rank']} {t['name']}" if t["rank"] else t["name"]
            for t in (away, home)
        ]
        card.text(W / 2, 138, f"{named[0]} @ {named[1]}", 52, BOLD, max_w=W - 2 * PAD)
        for team, cx in ((away, 330), (home, 870)):
            card.logo(team, league, logo_fetch, cx, 315, 200)
            if team["record"]:
                card.text(cx, 470, team["record"], 28, color=MUTED)
        card.text(W / 2, 330, "@", 60, BOLD, MUTED, va="center")
        venue = (game.get("gameInfo") or {}).get("venue") or {}
        address = venue.get("address") or {}
        where = ", ".join(
            x
            for x in (venue.get("fullName"), address.get("city"), address.get("state"))
            if x
        )
        if where:
            card.text(W / 2, 525, where, 26, color=MUTED, max_w=W - 2 * PAD)
        proj = game.get("projection") or {}
        if proj.get("margin") is not None:
            fav, wp = (
                (home, proj.get("homeWinProb"))
                if proj["margin"] >= 0
                else (
                    away,
                    1 - proj["homeWinProb"]
                    if proj.get("homeWinProb") is not None
                    else None,
                )
            )
            card.text(
                PAD,
                590,
                f"Projection: {fav['abbr']} by {abs(proj['margin']):.1f}"
                + (f" ({round(100 * wp)}%)" if wp is not None else ""),
                26,
                BOLD,
                ha="left",
            )
    else:
        if state == "live":
            stamp = (
                f"Live / {asof}"
                if spoilerfree
                else f"Live / {_live_clock(status)} / {asof}"
            )
        else:
            detail = (status.get("type") or {}).get("detail") or ""
            final = (
                detail if detail.startswith("Final") and not spoilerfree else "Final"
            )
            stamp = " / ".join(x for x in (final, context, day) if x)
        card.text(W / 2, 58, stamp, 26, color=MUTED, max_w=W - 2 * PAD)
        title = (
            f"{away['name']} @ {home['name']}"
            if spoilerfree
            else f"{away['name']} {away['score']} @ {home['name']} {home['score']}"
        )
        card.text(W / 2, 138, title, 52, BOLD, max_w=W - 2 * (PAD + 96 + 24))
        card.logo(away, league, logo_fetch, PAD + 48, 120, 96)
        card.logo(home, league, logo_fetch, W - PAD - 48, 120, 96)
        if spoilerfree:
            ex = excitement.summary(game)
            so_far = " so far" if state == "live" else ""
            tiles = (
                (
                    f"{ex['gei']:.2f}" if ex["gei"] is not None else "—",
                    f"Game Excitement Index{so_far}",
                ),
                (str(ex["lead_changes"]), f"Lead changes{so_far}"),
                (
                    f"{round(ex['max_swing_pts'])}%"
                    if ex["max_swing_pts"] is not None
                    else "—",
                    f"Biggest WP swing{so_far}",
                ),
            )
            for (value, label), cx in zip(tiles, (W / 6, W / 2, 5 * W / 6)):
                card.text(cx, 375, value, 88, BOLD)
                card.text(cx, 430, label, 26, color=MUTED, max_w=W / 3 - PAD)
            card.text(PAD, 590, "Score hidden", 26, color=MUTED, ha="left")
        else:
            completed = state == "final"
            card.wp(
                game.get("plays") or [],
                home,
                away,
                completed,
                1.0 if completed else _elapsed(status),
                190,
                530,
            )
            share = (game.get("paperIndex") or {}).get("homeShare")
            if completed and share is not None:
                side, pct = (home, share) if share >= 0.5 else (away, 1 - share)
                card.text(
                    PAD,
                    590,
                    f"Deserved Win %: {side['abbr']} {round(100 * pct)}%",
                    26,
                    BOLD,
                    ha="left",
                )
    card.text(W - PAD, 590, "gameonpaper.com", 26, color=MUTED, ha="right")
    return card.png()


def _period_label(regulation):
    """Basketball's period names: Q2..Q4 for quarters, H2 for halves, OT past regulation."""
    return lambda p: "OT" if p > regulation else (f"H{p}" if regulation == 2 else f"Q{p}")


def _bball_elapsed(plays, regulation):
    """Share of regulation played, from the plays' game seconds remaining (1 once overtime starts)."""
    left = [p[2] for p in plays if p[2] is not None]
    if not left or int(plays[-1][0] or 0) > regulation or max(left) <= 0:
        return 1.0
    return min(1.0, (max(left) - left[-1]) / max(left))


def render_basketball(
    game: dict,
    league: str,
    state: str,
    logo_fetch,
    now: datetime,
    drawn: list | None = None,
) -> bytes:
    """A basketball game's card (nba/wnba/mbb/wbb) as PNG bytes, in the football card's layout.

    `game` is the body the Worker builds from the page's own game (astro basketball/shareCard.ts): each side's
    names, score, colors and logo URL, ESPN's status detail, the date, the regulation periods, the plays as
    [period, home WP, game seconds remaining] and, on a final, the game excitement index. Live or final only:
    a pregame page keeps the site's social card.
    """
    if state not in ("live", "final"):
        raise ValueError(f"state {state!r}")
    home, away = ({**game[s], "id": str(game[s].get("id")), "color": _color(game[s])} for s in ("home", "away"))
    regulation = int(game.get("regulation") or 4)
    kickoff = _kickoff(game)
    detail = (game.get("detail") or "").strip()
    card = _Card(drawn)
    if state == "live":
        stamp = " / ".join(x for x in ("Live", detail, f"as of {_clock12(now.astimezone(ET))} ET") if x)
    else:
        day = f"{kickoff:%b} {kickoff.day}, {kickoff.year}" if kickoff else ""
        stamp = " / ".join(x for x in (detail if detail.startswith("Final") else "Final", day) if x)
    card.text(W / 2, 58, stamp, 26, color=MUTED, max_w=W - 2 * PAD)
    title = f"{away['name']} {away['score']} @ {home['name']} {home['score']}"
    card.text(W / 2, 138, title, 52, BOLD, max_w=W - 2 * (PAD + 96 + 24))
    card.logo(away, league, logo_fetch, PAD + 48, 120, 96)
    card.logo(home, league, logo_fetch, W - PAD - 48, 120, 96)
    plays = game.get("plays") or []
    pts = [(int(p[0] or 0), float(p[1])) for p in plays if p[1] is not None]
    final = state == "final"
    if pts and final:
        pts.append((pts[-1][0], _result(home, away)))  # the result, as the page's chart ends
    card.line(pts, home, away, 1.0 if final else _bball_elapsed(plays, regulation), 190, 530, _period_label(regulation))
    # the game excitement index, a final's only (the Worker sends none for a live game)
    if final and game.get("gei") is not None:
        card.text(PAD, 590, f"Game Excitement Index: {float(game['gei']):.2f}", 26, BOLD, ha="left")
    card.text(W - PAD, 590, "gameonpaper.com", 26, color=MUTED, ha="right")
    return card.png()


def render_basketball_stats(
    body: dict,
    league: str,
    logo_fetch,
    drawn: list | None = None,
) -> bytes:
    """A basketball player or team page's card (nba/wnba/mbb/wbb) as PNG bytes.

    `body` is the Worker's (astro basketball/statCard.ts): `stamp` (league and season), `title` (the player or the
    team), `subtitle` (team, games, record), `team` (id, abbr, colors, logo URL) and up to four `tiles`, each a
    `value` and `label` already formatted from the producer's columns, with the producer's `rank` or None. This
    draws strings; it computes nothing.
    """
    team = {**body["team"], "id": str(body["team"].get("id")), "color": _color(body["team"])}
    card = _Card(drawn)
    card.text(W / 2, 58, body.get("stamp") or "", 26, color=MUTED, max_w=W - 2 * PAD)
    card.text(W / 2, 150, body["title"], 60, BOLD, max_w=W - 2 * (PAD + 120 + 24))
    card.logo(team, league, logo_fetch, PAD + 60, 135, 120)
    if body.get("subtitle"):
        card.text(W / 2, 205, body["subtitle"], 30, color=MUTED, max_w=W - 2 * (PAD + 120 + 24))
    tiles = (body.get("tiles") or [])[:4]
    for i, tile in enumerate(tiles):
        cx = (2 * i + 1) * W / (2 * len(tiles))
        card.text(cx, 385, tile["value"], 80, BOLD, team["color"], max_w=W / len(tiles) - PAD)
        card.text(cx, 440, tile["label"], 26, color=MUTED, max_w=W / len(tiles) - PAD)
        if tile.get("rank"):
            card.text(cx, 482, tile["rank"], 26, BOLD, max_w=W / len(tiles) - PAD)
    if body.get("note"):
        card.text(PAD, 590, body["note"], 22, color=MUTED, ha="left", max_w=W - 2 * PAD - 260)
    card.text(W - PAD, 590, "gameonpaper.com", 26, color=MUTED, ha="right")
    return card.png()
