const SERVICE_NAME = process.env.SERVICE_NAME || "frontend";

const logger = require('tracer').colorConsole({
    format: "{{timestamp}}" + ` [${SERVICE_NAME}] ` + "<{{title}}> {{path}}:{{line}} ({{method}}) {{message}}",
    dateformat: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'"
});

module.exports = logger