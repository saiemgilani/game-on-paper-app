import { basketballStatCardRoute } from '../../../../routes/basketball/statCard';

export const prerender = false;
export const GET = basketballStatCardRoute('wbb', 'players');
