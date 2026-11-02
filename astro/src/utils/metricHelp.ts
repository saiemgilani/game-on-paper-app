// Metric help on tap (N6, flag 'metric-help'): a leaderboard column's glossary definition, shown in a
// native popover (<button popovertarget> + <div popover>), so it opens on a tap where <abbr title> never
// shows, with no script. The copy is the glossary's own entry and the link is its /glossary/ anchor, so
// nothing here is new public text.
import { generateGlossaryItems } from '../resources/glossary';
import { METRIC_GLOSSARY_TERMS } from './constants';
import { termSlugs } from './seo';

export interface MetricHelp { slug: string; term: string; definition: string; href: string }

// resolved over the whole glossary exactly as pages/glossary.astro resolves its ids, so the anchor lands
const TERMS = [...generateGlossaryItems().values()].flat();
const SLUGS = termSlugs(TERMS);

export function metricHelp(key: string): MetricHelp | null {
    const name = METRIC_GLOSSARY_TERMS.find(([re]) => re.test(key))?.[1];
    const entry = name ? TERMS.find((t) => t.term === name) : undefined;
    const slug = entry && SLUGS.get(entry);
    if (!entry || !slug) return null;
    return { slug, term: entry.term, definition: entry.definition, href: `/glossary/#${slug}` };
}

const attr = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

/** The " ?" (leading space included) beside a column title; '' when the metric has no glossary entry. */
export function metricHelpButton(key: string): string {
    const h = metricHelp(key);
    if (!h) return '';
    return ` <button type="button" class="btn btn-link p-0 align-baseline metric-help-btn" popovertarget="help-${h.slug}" aria-label="${attr(`What is ${h.term}?`)}"><i class="bi bi-question-circle" aria-hidden="true"></i></button>`;
}

// the glossary copy links to its own sections as href='#glossary-section-X'; off the glossary page they need the path
const offPage = (html: string) => html.replace(/href=(['"])#/g, 'href=$1/glossary/#');

/** One popover per distinct glossary term among `keys` (three SR% columns share one). */
export function metricHelpPopovers(keys: string[]): string {
    const seen = new Map<string, MetricHelp>();
    for (const k of keys) {
        const h = metricHelp(k);
        if (h && !seen.has(h.slug)) seen.set(h.slug, h);
    }
    return [...seen.values()].map((h) =>
        `<div id="help-${h.slug}" popover class="metric-help border rounded p-2 small bg-body text-body"><a href="${h.href}"><strong>${h.term}</strong></a><div>${offPage(h.definition)}</div></div>`,
    ).join('');
}
