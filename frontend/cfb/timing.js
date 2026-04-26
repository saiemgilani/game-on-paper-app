// Per-request timing accumulator wired to a Server-Timing response header.
//
// Usage:
//   app.use(timingMiddleware());                         // once, before routes
//   const data = await time(res, 'python', () => ...);   // in any handler
//
// On res.render() / res.json() / res.send() the accumulated timings are
// flattened into a single Server-Timing header and a structured metrics line
// is logged.

function header(timings) {
    return Object.entries(timings)
        .map(([name, ms]) => `${name};dur=${ms.toFixed(0)}`)
        .join(', ');
}

function logMetrics(req, res, timings) {
    const line = {
        event: 'request',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ...Object.fromEntries(
            Object.entries(timings).map(([k, v]) => [`${k}_ms`, Math.round(v)])
        ),
    };
    process.stdout.write(JSON.stringify(line) + '\n');
}

function timingMiddleware() {
    return function (req, res, next) {
        const requestStart = process.hrtime.bigint();
        res.locals.timings = {};

        const finalize = () => {
            res.locals.timings.total =
                Number(process.hrtime.bigint() - requestStart) / 1e6;
            const value = header(res.locals.timings);
            if (value && !res.headersSent) {
                res.setHeader('Server-Timing', value);
            }
            try {
                logMetrics(req, res, res.locals.timings);
            } catch {
                // logging must never break a response
            }
        };

        for (const fn of ['render', 'json', 'send']) {
            const orig = res[fn].bind(res);
            res[fn] = function (...args) {
                finalize();
                return orig(...args);
            };
        }

        next();
    };
}

async function time(res, name, fn) {
    const t0 = process.hrtime.bigint();
    try {
        return await fn();
    } finally {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (res && res.locals && res.locals.timings) {
            // accumulate if a name fires more than once in a request
            res.locals.timings[name] = (res.locals.timings[name] || 0) + ms;
        }
    }
}

module.exports = { timingMiddleware, time };
