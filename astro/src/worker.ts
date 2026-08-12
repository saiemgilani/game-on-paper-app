import { handle } from '@astrojs/cloudflare/handler';
import { getCurrentScoreboard } from './resources/espn';



export default {
    async fetch(request, env, ctx) {
        return handle(request, env, ctx);
    },
    async scheduled(controller, env, ctx) {
        // NOTE: offseason config
        switch (controller.cron || "0 0 * * *") {
            case "0 0 * * *":
                try {
                    await getCurrentScoreboard(false, true);
                } catch (err) {
                    console.error(`ERROR while reloading scoreboard cache: ${err}`)
                }
                break;
        }
    },
} satisfies ExportedHandler<Env>;