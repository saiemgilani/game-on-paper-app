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

/** The URL always; the data time too while the game can still change. */
export function wpExportFooter(meta: WpExportMeta, formatTime: (iso: string) => string): string {
    return (!meta.completed && meta.updatedAt) ? `${meta.url} | Updated ${formatTime(meta.updatedAt)}` : meta.url;
}
