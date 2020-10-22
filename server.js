//dependances
const express = require('express');
const path = require('path');
const history = require('connect-history-api-fallback');
const cors = require('cors')
const compression = require ('compression')

app = express()
app.use(compression())

// pour forcer express à servir l'app statiquement
const staticFileMiddleware = express.static(path.join(__dirname + '/dist'));

app.use(staticFileMiddleware)

//mode 'history' pour entre autres éviter les adresses en ' /#.... '
app.use(history({
    disableDotRule: true,
    verbose: true
  }));
app.use(staticFileMiddleware);

//routage pour utiliser comme paramètres GET les chaînes après le premier '/ '
const routes = require('./router.js')
app.use('/api', routes) //point d'entrée pour les appels axios depuis le client

app.use(cors())

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:' + port)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE')
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type')
    next()
})

//en conjonction avec staticFileMiddleWare, routage vers l'index
app.get('/', function (req, res) {
    res.render(path.join(__dirname + '/dist/index.html'));
})

const port = process.env.PORT || 5000;
app.listen(port)

console.log('server started '+ port)

//autofetching matches & saving stats into db
require('./server_autofetch/index.js')