const express = require('express');
const router = require('./src/routes/router');
const port = process.env.PORT || 5000

const app = express();
app.use(router);


app.listen(port, () => {
    console.log(`listening on port ${port}`)
})
git remote add origin git://github.com/saiemgilani/cfb-data-api.git