const {Pool} = require("node-beanstalk");

const BEANSTALK_CLIENT_POOL = new Pool(
    { 
        clientOptions: {
            host: 'beanstalkd',
            port: 11300,
        },
        capacity: (process.env.NUM_CLIENTS || 1) 
    }
);

module.exports = {
    BEANSTALK_CLIENT_POOL
}