const express = require('express');
const router = require('./app/routes/router');
const port = process.env.PORT || 5000

const app = express();
app.use(router);


app.listen(port, () => {
    console.log(`listening on port ${port}`)
})
