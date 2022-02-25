const mySQL = require('mysql');
const dotenv = require('dotenv');
const e = require('express');
dotenv.config();

const DATABASE = 'IMDB_ijs';

const isolationLevelDefault = `READ COMMITTED`;
const isolationLevelSql = `SET SESSION TRANSACTION ISOLATION LEVEL `;

const centralPool = mySQL.createPool({
	connectionLimit: 20,
	host: process.env.CENTRAL_URL,
	port: process.env.DB_PORT,
	user: process.env.CENTRAL_USERNAME,
	password: process.env.CENTRAL_PASSWORD,
	database: DATABASE,
	connectTimeout: 30000
});

const node2Pool = mySQL.createPool({
	connectionLimit: 20,
	host: process.env.NODE2_URL,
	port: process.env.DB_PORT,
	user: process.env.NODE2_USERNAME,
	password: process.env.NODE2_PASSWORD,
	database: DATABASE,
	connectTimeout: 30000
});

const node3Pool = mySQL.createPool({
	connectionLimit: 20,
	host: process.env.NODE3_URL,
	port: process.env.DB_PORT,
	user: process.env.NODE3_USERNAME,
	password: process.env.NODE3_PASSWORD,
	database: DATABASE,
	connectTimeout: 30000
});

const incomplete = 'Some of our servers are unavailable at the moment. Search results may be incomplete.';
const noResults = 'None of our servers are available at the moment. Please try again later.';

const homeController = {
	getView: function (req, res) {
		const sql = `SELECT * FROM movies ORDER BY id DESC LIMIT 2000`;
		const textReportSQL1 = 'SELECT movies.genre, COUNT(movies.id) AS num_movies FROM movies GROUP BY movies.genre ORDER BY COUNT(movies.id) DESC';
		const textReportSQL2 = 'SELECT genre, director, ROUND(Ave_rank, 2) AS ave_rank FROM ( SELECT movies.genre, movies.director, AVG(movies.`rank`) AS Ave_rank, RANK() OVER '
							+  '(PARTITION BY movies.genre ORDER BY AVG(movies.`rank`) DESC) AS Ave_movies_rank FROM movies GROUP BY movies.genre, movies.director )'
							+  'AS Movies_rank WHERE Ave_movies_rank <= 10;';
		const textReportSQL3 = 'SELECT `year`, actor1 AS actor, Num_roles FROM (SELECT movies.year, movies.actor1, COUNT(movies.id) AS Num_roles, RANK() OVER'
							+  '(PARTITION BY movies.year ORDER BY COUNT(movies.id) DESC) AS Num_roles_rank FROM movies GROUP BY movies.year, movies.actor1'
							+  ') AS Roles_rank WHERE Num_roles_rank = 1;';

		centralPool.getConnection(function (err, connection) {
			if (err) throw err;
			else {
				const setIsolationLevel = isolationLevelSql + isolationLevelDefault;
				connection.query(setIsolationLevel, function (err) {
					if (err) {
						throw err;
					}

					connection.beginTransaction(function (err) {
						if (err) {
							throw err;
						}

						connection.query(sql, function (err, result) {
							if (err) {
								connection.rollback(function () {
									throw err;
								});
							}

							connection.commit(function (err) {
								if (err) {
									connection.rollback(function () {
										throw err;
									});
								}

								connection.beginTransaction(function(err){
									if(err) throw err;
			
									connection.query(textReportSQL1, function(err, reportResult1){
										if(err) {
											connection.rollback();
											throw err;
										}

										connection.query(textReportSQL2, function(err, reportResult2){
											if(err) {
												connection.rollback();
												throw err;
											}

											connection.query(textReportSQL3, function(err, reportResult3){
												if(err) {
													connection.rollback();
													throw err;
												}
											
												connection.commit(function(err){
													if (err) {
														connection.rollback(function(){
															throw err
														})
													}

													const resultObj = {
														allData: result,
														report1: reportResult1,
														report2: reportResult2,
														report3: reportResult3
													}
	
													res.render('home', { resultObj });
												})
											})
										})
									});
								});
							});
						});
					});
				});
			}
		});
	},

	searchEntry: function (req, res) {
		const searchCriteria = req.query.searchCriteria.trim();
		const isolationLevel = req.query.isolationLevel;

		const setIsolationLevel = isolationLevelSql + isolationLevel;

		// Search all - RECOVERY DONE
		if (searchCriteria.length == 0) {
			const sql = `SELECT * FROM movies ORDER BY id LIMIT 100`;

			// Connect to central node
			centralPool.getConnection(function (err, centralConnection) {
				if (err) throw err;

				// Destroy central connection to simulate accessing node 2 & 3
				//	centralConnection.destroy();

				// Ping central node
				centralConnection.ping(function (err) {
					// Cental node fail
					if (err) {
						console.log('Central node failed!');

						// Connect to Node 2
						node2Pool.getConnection(function (err, node2Connection) {
							if (err) throw err;

							//	node2Connection.destroy();

							// Ping Node 2
							node2Connection.ping(function (err) {
								// Node 2 fail
								if (err) {
									console.log('Node 2 failed!');

									// Connect to Node 3
									node3Pool.getConnection(function (err, node3Connection) {
										if (err) throw err;

										//	node3Connection.destroy();

										// Ping Node 3
										node3Connection.ping(function (err) {
											// Node 3 fail
											if (err) {
												console.log('Node 3 failed!');
												console.log('Results none --> Servers down');
												// Send NO DATA because all servers are down
												res.send([[], noResults]);
											}
											// Node 3 works
											else {
												console.log('Node 3 available!');

												node3Connection.query(setIsolationLevel, function (err) {
													if (err) {
														throw err;
													}

													// Get INCOMPLETE data from node 3
													node3Connection.beginTransaction(function (err) {
														if (err) {
															throw err;
														}

														node3Connection.query(sql, function (err, result) {
															if (err) {
																node3Connection.rollback(function () {
																	throw err;
																});
															}

															console.log('Results incomplete --> only from Node 3');
															node3Connection.commit(function (err) {
																if (err) {
																	node3Connection.rollback(function () {
																		throw err;
																	});
																}
															});
															// Send INCOMPLETE data from node 3
															res.send([result, incomplete]);
														});
													});
												});
											}
										});
									});
								}
								// Node 2 works
								else {
									node2Connection.query(setIsolationLevel, function (err) {
										if (err) {
											throw err;
										}

										node2Connection.beginTransaction(function (err) {
											if (err) {
												throw err;
											}

											// Get partial data from node 2
											node2Connection.query(sql, function (err, result) {
												if (err) {
													node2Connection.rollback(function () {
														throw err;
													});
												}

												console.log('Node 2 available!');
												node2Connection.commit(function (err) {
													if (err) {
														node2Connection.rollback(function () {
															throw err;
														});
													}
												});

												const node2result = result;

												node3Pool.getConnection(function (err, node3Connection) {
													if (err) throw err;

													// node3Connection.destroy();

													// Ping node 3
													node3Connection.ping(function (err) {
														// Node 3 fail
														if (err) {
															console.log('Node 3 failed!');
															// Send INCOMPLETE data from node 2
															console.log('Results incomplete --> only from Node 2');
															res.send([node2result, incomplete]);
														}
														// Node 3 works
														else {
															console.log('Node 3 Available!');

															node3Connection.query(setIsolationLevel, function (err) {
																if (err) {
																	throw err;
																}

																node3Connection.beginTransaction(function (err) {
																	if (err) {
																		throw err;
																	}

																	// Get partial data from node 3
																	node3Connection.query(sql, function (err, result) {
																		if (err) {
																			node3Connection.rollback(function () {
																				throw err;
																			});
																		}

																		node3Connection.commit(function (err) {
																			if (err) {
																				node3Connection.rollback(function () {
																					throw err;
																				});
																			}
																		});
																		// Send COMPLETE data from node 2 + node 3
																		console.log('Results complete --> Node 2 + Node 3');
																		res.send([node2result.concat(result), '']);
																	});
																});
															});
														}
													});
												});
											});
										});
									});
								}
							});
						});
					}
					// Central node works
					else {
						centralConnection.query(setIsolationLevel, function (err) {
							if (err) {
								throw err;
							}

							centralConnection.beginTransaction(function (err) {
								if (err) {
									throw err;
								}

								centralConnection.query(sql, function (err, result) {
									if (err) {
										centralConnection.rollback(function () {
											throw err;
										});
									}

									console.log('Central node available!');
									console.log('Results complete --> Central Node');
									centralConnection.commit(function (err) {
										if (err) {
											centralConnection.rollback(function () {
												throw err;
											});
										}
									});
									// Send COMPLETE data from central node
									res.send([result, '']);
								});
							});
						});
						// Get complete data from central node
					}
				});
			});
		} else {
			// SEARCH SPECIFIC
			const sql = `SELECT * FROM movies 
				WHERE id = ? 
				OR name LIKE ?
				OR genre LIKE ? 
				OR director LIKE ?
				OR actor1 LIKE ?
				OR actor2 LIKE ?
				LIMIT 2000`;
			const substr = `%${searchCriteria}%`;

			node2Pool.getConnection(function (err, node2Connection) {
				if (err) throw err;

				// node2Connection.destroy();

				// Ping node 2
				node2Connection.ping(function (err) {
					// Node 2 fail
					if (err) {
						console.log('Node 2 failed!');

						centralPool.getConnection(function (err, centralConnection) {
							if (err) throw err;

							// centralConnection.destroy();

							centralConnection.ping(function (err) {
								// Central node fail
								if (err) {
									console.log('Central node failed!');

									node3Pool.getConnection(function (err, node3Connection) {
										if (err) throw err;

										// node3Connection.destroy();

										node3Connection.ping(function (err) {
											// Node 3 fail
											if (err) {
												console.log('Node 3 failed!');
												console.log('Results None --> Servers down');
												// Send NO DATA because all servers are down
												res.send([[], noResults]);
											}
											// Node 3 works
											else {
												console.log('Results incomplete --> from node 3 only');

												node3Connection.query(setIsolationLevel, function (err) {
													if (err) {
														throw err;
													}

													node3Connection.beginTransaction(function (err) {
														if (err) {
															throw err;
														}

														// Get INCOMPLETE data from node 3
														node3Connection.query(sql, [searchCriteria, substr, substr, substr, substr, substr], function (err, result) {
															if (err) {
																node3Connection.rollback(function () {
																	throw err;
																});
															}

															node3Connection.commit(function (err) {
																if (err) {
																	node3Connection.rollback(function () {
																		throw err;
																	});
																}
															});
															// Send INCOMPLETE data from node 3
															res.send([result, incomplete]);
														});
													});
												});
											}
										});
									});
								}
								// Central node works
								else {
									centralConnection.query(setIsolationLevel, function (err) {
										if (err) {
											throw err;
										}

										centralConnection.beginTransaction(function (err) {
											if (err) {
												throw err;
											}

											// Get data from central node
											centralConnection.query(sql, [searchCriteria, substr, substr, substr, substr, substr], function (err, result) {
												if (err) {
													centralConnection.rollback(function () {
														throw err;
													});
												}

												console.log('Results complete, from Central Node');
												centralConnection.commit(function (err) {
													if (err) {
														centralConnection.rollback(function () {
															throw err;
														});
													}
												});
												// Send COMPLETE data from central node
												res.send([result, '']);
											});
										});
									});
								}
							});
						});
					}
					// Node 2 works
					else {
						node2Connection.query(setIsolationLevel, function (err) {
							if (err) {
								throw err;
							}

							node2Connection.beginTransaction(function (err) {
								if (err) {
									throw err;
								}

								// Check if specific search is in node 2
								node2Connection.query(sql, [searchCriteria, substr, substr, substr, substr, substr], function (err, result) {
									if (err) {
										node2Connection.rollback(function () {
											throw err;
										});
									}

									// Not in Node 2
									if (result.length == 0) {
										// Go to Node 3
										node3Pool.getConnection(function (err, node3Connection) {
											if (err) throw err;

											//	node3Connection.destroy();

											// Ping Node 3
											node3Connection.ping(function (err) {
												// Node 3 fail
												if (err) {
													console.log('Node 3 failed!');

													// Go to Central Node
													centralPool.getConnection(function (err, centralConnection) {
														if (err) throw err;

														//	centralConnection.destroy();

														// Ping Central Node
														centralConnection.ping(function (err) {
															// Central Node fail
															if (err) {
																console.log('Central node failed!');
																console.log('Results none --> Servers down');
																// Send NO DATA because all servers are down
																res.send([[], noResults]);
															}
															// Central Node works
															else {
																console.log('Central node is available!');
																centralConnection.query(setIsolationLevel, function (err) {
																	if (err) {
																		throw err;
																	}

																	centralConnection.beginTransaction(function (err) {
																		if (err) {
																			throw err;
																		}

																		// Send COMPLETE data from central node
																		centralConnection.query(sql, [searchCriteria, substr, substr, substr, substr, substr], function (err, result) {
																			if (err) {
																				centralConnection.rollback(function () {
																					throw err;
																				});
																			}

																			console.log('Results complete --> from Central Node');
																			centralConnection.commit(function (err) {
																				if (err) {
																					centralConnection.rollback(function () {
																						throw err;
																					});
																				}
																			});
																			res.send([result, '']);
																		});
																	});
																});
															}
														});
													});
												}
												// Node 3 works
												else {
													console.log('Node 3 available!');
													node3Connection.query(setIsolationLevel, function (err) {
														if (err) {
															throw err;
														}

														node3Connection.beginTransaction(function (err) {
															if (err) {
																throw err;
															}

															// Get COMPLETE data from node 3 because it's not in node 2
															node3Connection.query(sql, [searchCriteria, substr, substr, substr, substr, substr], function (err, result) {
																if (err) {
																	node3Connection.rollback(function () {
																		throw err;
																	});
																}

																console.log('Results complete --> from Node 3');
																node3Connection.commit(function (err) {
																	if (err) {
																		node3Connection.rollback(function () {
																			throw err;
																		});
																	}
																});
																// Send COMPLETE data which was found in node 3
																res.send([result, '']);
															});
														});
													});
												}
											});
										});
									}
									// Result in node 2
									else {
										const node2Result = result;
										node2Connection.commit(function (err) {
											if (err) {
												node2Connection.rollback(function () {
													throw err;
												});
											}
										});

										// Ping node 3
										node3Pool.getConnection(function (err, node3Connection) {
											if (err) throw err;

											// node3Connection.destroy();

											node3Connection.ping(function (err) {
												// Node 3 fail
												if (err) {
													console.log('Node 3 failed!');

													// Go to central node
													centralPool.getConnection(function (err, centralConnection) {
														if (err) throw err;

														// centralConnection.destroy();

														centralConnection.ping(function (err) {
															// Central node fail
															if (err) {
																console.log('Central node failed!');
																console.log('Results incomplete --> only from node 2');
																res.send([node2Result, incomplete]);
															}
															// Central node works
															else {
																console.log('Central node available!');
																centralConnection.query(setIsolationLevel, function (err) {
																	if (err) {
																		throw err;
																	}

																	centralConnection.beginTransaction(function (err) {
																		if (err) {
																			throw err;
																		}

																		centralConnection.query(sql, [searchCriteria, substr, substr, substr, substr, substr], function (err, result) {
																			if (err) {
																				centralConnection.rollback(function () {
																					throw err;
																				});
																			}

																			centralConnection.commit(function (err) {
																				if (err) {
																					centralConnection.rollback(function () {
																						throw err;
																					});
																				}
																			});
																			// Send COMPLETE results from central node
																			console.log('Results complete --> from central node');
																			res.send([result, '']);
																		});
																	});
																});
															}
														});
													});
												}
												// Node 3 works
												else {
													node3Connection.query(setIsolationLevel, function (err) {
														if (err) {
															throw err;
														}

														node3Connection.beginTransaction(function (err) {
															if (err) {
																throw err;
															}

															// Query in node 3 as well
															node3Connection.query(sql, [searchCriteria, substr, substr, substr, substr, substr], function (err, result) {
																if (err) {
																	node3Connection.rollback(function () {
																		throw err;
																	});
																}

																node3Connection.commit(function (err) {
																	if (err) {
																		node3Connection.rollback(function () {
																			throw err;
																		});
																	}
																});
																// Send COMPLETE result from node 2 and node 3
																console.log('Results complete --> from node 2 + node 3');
																res.send([node2Result.concat(result), '']);
															});
														});
													});
												}
											});
										});
									}
								});
							});
						});
					}
				});
			});
		}
	}
};

module.exports = homeController;
