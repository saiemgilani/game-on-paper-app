const logger = require('tracer').colorConsole({
    format: "{{timestamp}} <{{title}}> {{path}}:{{line}} ({{method}}) {{message}}",
    dateformat: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'"
});

module.exports = logger