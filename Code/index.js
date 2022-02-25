// import necessary modules
const express = require('express');
const dotenv = require('dotenv');
const hbs = require('hbs');

// import necessary files
const routes = require('./routes.js');

const app = express();

app.set('view engine', 'hbs');

hbs.registerPartials(__dirname + '/views/partials');

// initialize .env properties
dotenv.config();
port = process.env.PORT || 3000;
hostname = process.env.HOSTNAME || 3000;

app.use(express.urlencoded({ extended: true }));

app.use(express.static('public'));

app.listen(port, hostname, function () {
	console.log(`Server running at: `);
	console.log(`http://` + hostname + `:` + port);
});

app.use('/', routes);
