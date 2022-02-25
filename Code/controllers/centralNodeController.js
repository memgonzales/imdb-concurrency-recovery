const mySQL = require('mysql');
const dotenv = require('dotenv');
dotenv.config();

const DATABASE = 'IMDB_ijs';

const centralConnection = mySQL.createConnection({
	host: process.env.CENTRAL_URL,
	port: process.env.DB_PORT,
	user: process.env.CENTRAL_USERNAME,
	password: process.env.CENTRAL_PASSWORD,
	database: DATABASE
});

const centralNodeController = {
	getView: function (req, res) {
		const sql = 'SELECT * FROM movies ORDER BY id DESC';

		centralConnection.beginTransaction(function(err){
			if(err){
				throw err;
			}

			centralConnection.query(sql, function (err, result, moviesArray) {
				if (err) {
					centralConnection.rollback(function(){
						throw err;
					});
				}
	
				centralConnection.commit(function(err) {
					if(err){
						centralConnection.rollback(function(){
							throw err;
						});
					}
				});

				res.render('node1', { result });
			});
		});
	}
};

module.exports = centralNodeController;
