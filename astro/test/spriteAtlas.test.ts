import { afterEach, describe, expect, test } from 'vitest';
import { buildAtlas, packFrames } from '../src/utils/spriteAtlas';

// Twin of sportsdataverse-web test/spriteAtlas.test.ts (roadmap F14 T3), same packFrames contract.
describe('packFrames', () => {
    test('lays ids out row-major in cell-sized squares', () => {
        expect(packFrames(['61', '333', '251'], 64, 2)).toEqual({
            61: { x: 0, y: 0, w: 64, h: 64 },
            333: { x: 64, y: 0, w: 64, h: 64 },
            251: { x: 0, y: 64, w: 64, h: 64 },
        });
    });

    test('keeps the first slot for a duplicate id', () => {
        expect(packFrames(['61', '61'], 64, 4)).toEqual({ 61: { x: 0, y: 0, w: 64, h: 64 } });
    });

    test('stores "__proto__" as an own frame, not as the prototype', () => {
        const frames = packFrames(['__proto__', '61'], 64, 2);
        expect(Object.hasOwn(frames, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(frames)).toBe(Object.prototype);
        expect(Object.keys(frames).sort()).toEqual(['61', '__proto__']);
        expect(frames['61']).toEqual({ x: 64, y: 0, w: 64, h: 64 });
    });

    test('refuses a grid narrower than one column', () => {
        expect(() => packFrames(['61'], 64, 0)).toThrow(RangeError);
        expect(() => packFrames(['61'], 64, Number.NaN)).toThrow(RangeError);
    });
});

describe('buildAtlas (browser-only; faked canvas and Image)', () => {
    const g = globalThis as { document?: unknown; Image?: unknown };
    afterEach(() => {
        delete g.document;
        delete g.Image;
    });

    function fakeDom(fail: (src: string) => boolean = () => false) {
        const state = { inFlight: 0, peak: 0, pending: [] as (() => void)[], drawn: [] as unknown[][], canvas: { width: 0, height: 0 } as any };
        class FakeImage {
            crossOrigin = '';
            width = 48;
            height = 48;
            onload: () => void = () => {};
            onerror: () => void = () => {};
            set src(s: string) {
                state.inFlight++;
                state.peak = Math.max(state.peak, state.inFlight);
                state.pending.push(() => {
                    state.inFlight--;
                    if (fail(s)) this.onerror();
                    else this.onload();
                });
            }
        }
        state.canvas.getContext = () => ({ drawImage: (...a: unknown[]) => state.drawn.push(a) });
        g.document = { createElement: () => state.canvas };
        g.Image = FakeImage;
        return state;
    }

    async function drain(state: ReturnType<typeof fakeDom>) {
        while (state.pending.length || state.inFlight) {
            state.pending.shift()?.();
            await new Promise((r) => setTimeout(r, 0));
            expect(state.inFlight).toBeLessThanOrEqual(16);
        }
    }

    test('keeps at most 16 images in flight and still draws every one', async () => {
        const state = fakeDom();
        const built = buildAtlas(Array.from({ length: 40 }, (_, i) => ({ id: String(i), src: `s${i}` })), 48);
        expect(state.inFlight).toBe(16);
        await drain(state);
        const { frames, canvas } = await built;
        expect(Object.keys(frames)).toHaveLength(40);
        expect(state.drawn).toHaveLength(40);
        expect(state.peak).toBe(16);
        // cols = ceil(sqrt(40)) = 7
        expect([canvas.width, canvas.height]).toEqual([7 * 48, 6 * 48]);
    });

    test('an image that fails is dropped from frames; a duplicate id loads once', async () => {
        const state = fakeDom((s) => s === 'bad');
        const built = buildAtlas([{ id: 'a', src: 'ok' }, { id: 'b', src: 'bad' }, { id: 'a', src: 'again' }], 64);
        await drain(state);
        const { frames } = await built;
        expect(frames).toEqual({ a: { x: 0, y: 0, w: 64, h: 64 } });
        expect(state.drawn).toHaveLength(1);
    });
});
