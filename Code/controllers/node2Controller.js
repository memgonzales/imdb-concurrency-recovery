const mySQL = require('mysql');
const dotenv = require('dotenv');
dotenv.config();

const DATABASE = 'IMDB_ijs';

const node2Connection = mySQL.createConnection({
	host: process.env.NODE2_URL,
	port: process.env.DB_PORT,
	user: process.env.NODE2_USERNAME,
	password: process.env.NODE2_PASSWORD,
	database: DATABASE,
	connectTimeout: 30000
});

const node2Controller = {
	getView: function (req, res) {
		const sql = 'SELECT * FROM movies ORDER BY id DESC';

		node2Connection.beginTransaction(function(err) {
			if(err) {
				throw err;
			}

			node2Connection.query(sql, function (err, result, moviesArray) {
				if (err) {
					node2Connection.rollback(function(){
						throw err;
					});
					throw err;
				}
	
				node2Connection.commit(function(err) {
					if(err){
						node2Connection.rollback(function(){
							throw err;
						});
					}
				});
				res.render('node2', { result });
			});
		});
		
	}
};

module.exports = node2Controller;
