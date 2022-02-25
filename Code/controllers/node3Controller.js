const mySQL = require('mysql');
const dotenv = require('dotenv');
dotenv.config();

const DATABASE = 'IMDB_ijs';

// create connection to AWS mySQL database
const node3Connection = mySQL.createConnection({
	host: process.env.NODE3_URL,
	port: process.env.DB_PORT,
	user: process.env.NODE3_USERNAME,
	password: process.env.NODE3_PASSWORD,
	database: DATABASE,
	connectTimeout: 30000
});

const node3Controller = {
	getView: function (req, res) {
		const sql = 'SELECT * FROM movies ORDER BY id DESC';

		node3Connection.beginTransaction(function(err) {
			if(err){
				throw err;
			}

			node3Connection.query(sql, function (err, result, moviesArray) {
				if (err) {
					node3Connection.rollback(function(){
						throw err;
					});
				}
	
				node3Connection.commit(function(err) {
					if(err){
						node3Connection.rollback(function(){
							throw err;
						});
					}
				});
				res.render('node3', { result });
			});
		});
	}
};

module.exports = node3Controller;
