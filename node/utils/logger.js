const SERVICE_NAME = process.env.SERVICE_NAME || "frontend";

import { colorConsole } from 'tracer';

const logger = colorConsole({
    format: "{{timestamp}}" + ` [${SERVICE_NAME}] ` + "<{{title}}> {{path}}:{{line}} ({{method}}) {{message}}",
    dateformat: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'"
});

export default logger;