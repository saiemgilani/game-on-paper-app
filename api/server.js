const express = require('express');
const router = require('./routes/router');
const morgan = require("morgan");
const port = process.env.PORT || 5000

const app = express();
app.use(morgan('[api] :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]'));
app.use(router);

app.listen(port, () => {
    console.log(`listening on port ${port}`)
})
