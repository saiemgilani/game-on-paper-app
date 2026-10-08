import { cleanLocation } from './misc';

export interface WpExportMeta {
    title: string
    url: string
    completed: boolean
    /** when /process built the data; null until the payload carries it */
    updatedAt: string | null
}

/** "away 30 @ home 27: Win Probability (Final)": the page's own h1 wording, then what the image is. */
export function wpExportTitle(awayComp: any, homeComp: any, statusDetail: string): string {
    return `${cleanLocation(awayComp.team)} ${awayComp.score} @ ${cleanLocation(homeComp.team)} ${homeComp.score}: Win Probability (${statusDetail})`;
}

/** A data time for a shared image: the viewer's local time, with its zone named so the image reads anywhere. */
export function exportTime(iso: string, opts: { locale?: string; timeZone?: string } = {}): string {
    return new Intl.DateTimeFormat(opts.locale, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: opts.timeZone,
    }).format(new Date(iso));
}

/** The URL always; the data time too while the game can still change. */
export function wpExportFooter(meta: WpExportMeta, formatTime: (iso: string) => string): string {
    return (!meta.completed && meta.updatedAt) ? `${meta.url} | Updated ${formatTime(meta.updatedAt)}` : meta.url;
}
