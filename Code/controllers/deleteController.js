const mySQL = require('mysql');
const dotenv = require('dotenv');
const e = require('express');
const { isBuffer } = require('util');
dotenv.config();

const DATABASE = 'IMDB_ijs';

const isolationLevelDefault = `REPEATABLE READ`;
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

let timer = 0;
let node2Timer = 0;

const deleteController = {
	deleteEntry: function (req, res) {
		const deleteId = req.body.id;

		const isolationLevel = req.body.isolationLevel;
        const setIsolationLevel = isolationLevelSql + isolationLevel;

		const sqlEntry = `DELETE FROM movies WHERE id=${deleteId}`;
		const sqlEntrySearch = `SELECT * FROM movies WHERE id=${deleteId}`;
		// const sqlEntryFill = 'INSERT INTO movies (id, name, year, genre, `rank`, director, actor1, actor2) VALUES (?,?,?,?,?,?,?,?)';
		const sqlLog = 'UPDATE log SET lock_status=?, next_trans_record=?, statements=? WHERE node_id=?';
		const sqlLogId = 'UPDATE log SET lock_status=?, next_trans_record=?, id_new_entry=?, statements=? WHERE node_id=?';
		const sqlLogCommit = 'UPDATE log SET lock_status=?, next_trans_record=?, next_trans_commit=?, statements=? WHERE node_id=?';
		const sqlLogFull = 'UPDATE log SET lock_status=?, next_trans_record=?, next_trans_commit=?, id_new_entry=?, statements=? WHERE node_id=?';
		const sqlLogNextCommit = 'UPDATE log SET next_trans_commit=? WHERE node_id=?';

		const sqlLogRead1 = 'SELECT * FROM log WHERE node_id = 1';
		const sqlLogRead2 = 'SELECT * FROM log WHERE node_id = 2';
		const sqlLogRead3 = 'SELECT * FROM log WHERE node_id = 3';
		const sqlLogReadAll = 'SELECT * FROM log';

		const sqlUnlockAll = 'UPDATE log SET lock_status=0';

		centralPool.getConnection(function (err, centralConnection) {
			if (err) {
				throw err;
			}

			// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy central node
			// centralConnection.destroy();

			// Ping central node
			centralConnection.ping(function (err) {
				// central node failed
				if (err) {
					console.log('Central node failed!');

					// check if node 2 has the entry
					node2Pool.getConnection(function (err, node2Connection) {
						if (err) {
							throw err;
						}

						// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy central node
						// node2Connection.destroy();

						console.log('Connecting to node 2');
						node2Connection.ping(function (err) {
							// node 2 failed
							if (err) {
								console.log('Node 2 failed!');
								console.log('Checking node 3');

								node3Pool.getConnection(function (err, node3Connection) {
									if (err) {
										throw err;
									}

									// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy central node
									// node3Connection.destroy();

									console.log('Connecting to node 3');
									node3Connection.ping(function (err) {
										// node 3 failed, all servers down
										if (err) {
											console.log('Node 3 failed!');
											res.send('Servers are unavailable at the moment. Please try again later.');
										}
										// node 3 available, check if node 3 has the entry
										else {
											node3Connection.query(setIsolationLevel, function (err) {
												if (err) {
													throw err;
												}

												node3Connection.beginTransaction(function (err) {
													if (err) {
														throw err;
													}

													// search for id in node 3
													node3Connection.query(sqlEntrySearch, function (err, result) {
														if (err) {
															node3Connection.rollback(function (err) {
																if (err) {
																	throw err;
																}
															});
														}

														// id not in node 3
														if (result[0] == undefined) {
															console.log('ID not found in node 3');
															console.log('No entry deleted');
															res.send('No entry deleted. Entry could have been in node 2 but the node is currently down. Please try again later.');
														}

														// id found in node 3
														else {
															console.log('ID found in node 3');

															// read central log file of node 3
															node3Connection.query(sqlLogRead1, function (err, result) {
																if (err) throw err;
																// console.log('lock: ' + result[0].lock_status);

																function beginDelete() {
																	node3Connection.query(sqlLogRead1, function (err, result) {
																		let lock = result[0].lock_status;
																		const timeoutId = setTimeout(beginDelete, 1000);
																		if (lock == 1) {
																			console.log('Node locked');
																			if (timer == 100) {
																				console.log('Timeout');
																				clearTimeout(timeoutId);
																				res.send('Our servers are busy at the moment. Please try again later.');
																			}
																			timer = timer + 1;
																		} else {
																			console.log('Node free');
																			clearTimeout(timeoutId);

																			// console.log('NOT LOCKED');

																			let newStatement = `||| ${result[0].next_trans_record} ${sqlEntry}`;
																			let deleteSQL = `${sqlEntry}`;

																			// add id to statement string
																			deleteSQL = newStatement.substr(newStatement.indexOf('D'));
																			// console.log('insertsql:' + deleteSQL);

																			// update log file values
																			result[0].lock_status = 1;
																			result[0].next_trans_record = result[0].next_trans_record + 1;
																			// console.log('newstatement: ' + newStatement);

																			// console.log('before concat: ' + result[0].statements);

																			if (result[0].statements == null) result[0].statements = newStatement;
																			else result[0].statements = result[0].statements + newStatement;

																			// console.log('=======================================');
																			// console.log('STATEMENT STR: ' + result[0].statements);
																			// console.log('=======================================');

																			const resultHolder = result[0];

																			// display log file contents w/ updated fields
																			// console.log(result[0]);

																			node3Connection.beginTransaction(function (err, result) {
																				if (err) {
																					throw err;
																				}

																				console.log('Executing update log file query in node 3');
																				// update central log file in node 3
																				node3Connection.query(sqlLog, [resultHolder.lock_status, resultHolder.next_trans_record, resultHolder.statements, 1], function (err, result) {
																					if (err) {
																						node3Connection.rollback(function () {
																							throw err;
																						});
																					}

																					console.log('Executing update log file commit in node 3');
																					node3Connection.commit(function (err) {
																						if (err) {
																							node3Connection.rollback(function () {
																								throw err;
																							});
																						}

																						console.log('Update Committed');
																						// begin transaction for deleting entry in movies table
																						node3Connection.beginTransaction(function (err) {
																							if (err) {
																								throw err;
																							}

																							console.log('Executing update movies table query in node 2');
																							// query for updating movies table using web app input
																							node3Connection.query(deleteSQL, function (err, result) {
																								if (err) {
																									node3Connection.rollback(function () {
																										throw err;
																									});
																								}

																								// commit movies table update
																								console.log('Executing update movies table commit');
																								node3Connection.commit(function (err) {
																									if (err) {
																										node3Connection.rollback(function () {
																											throw err;
																										});
																									}

																									console.log('Entry Deletion Successful!');
																									// start transaction to update next_trans_commit in node 3 log file in node 3
																									node3Connection.beginTransaction(function (err) {
																										if (err) {
																											throw err;
																										}

																										node3Connection.query(sqlLogRead3, function (err, result) {
																											if (err) {
																												node3Connection.rollback(function () {
																													throw err;
																												});
																											}

																											let statementStr = resultHolder.statements.split('||| ');
																											// console.log('Statement #' + resultHolder.next_trans_record + ':' + statementStr[resultHolder.next_trans_record]);
																											statementStr = statementStr[resultHolder.next_trans_record].substr(statementStr[resultHolder.next_trans_record].indexOf(' ') + 1);
																											// console.log('no number:' + statementStr);
																											// console.log('Committing Read');

																											let node3Log = result[0];

																											newStatement = `||| ${node3Log.next_trans_record} ${statementStr}`;

																											// increment next_trans_record and next_trans_commit for node 3 log file
																											node3Log.lock_status = 1;
																											node3Log.next_trans_record = node3Log.next_trans_record + 1;
																											node3Log.next_trans_commit = node3Log.next_trans_commit + 1;

																											// console.log('new statement:' + newStatement);
																											if (node3Log.statements == null) node3Log.statements = newStatement;
																											else node3Log.statements = node3Log.statements + newStatement;

																											// console.log('node 3 statements:' + node3Log.statements);

																											node3Connection.commit(function (err) {
																												if (err) {
																													node3Connection.rollback(function () {
																														throw err;
																													});
																												}
																											});

																											console.log('Commit successful!');
																											// console.log('w/ id value:' + statementStr);
																											// console.log('delete sql:' + deleteSQL);
																											// console.log(node3Log);

																											node3Connection.beginTransaction(function (err) {
																												if (err) {
																													throw err;
																												}

																												console.log('Executing query to update log file in node 3');
																												node3Connection.query(sqlLogCommit, [node3Log.lock_status, node3Log.next_trans_record, node3Log.next_trans_commit, node3Log.statements, 3], function (err, result) {
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
																														console.log('Update to log file committed');

																														// reconnect to central node to replicate
																														centralConnection.ping(function (err) {
																															if (err) {
																																console.log('Central node down');
																																let newCentralConnection;

																																// set delay before reconnecting to node 2
																																setTimeout(function () {
																																	centralPool.getConnection(function (err, connection) {
																																		if (err) {
																																			throw err;
																																		}
																																		newCentralConnection = connection;
																																		console.log('new connection established');
																																	});
																																}, 5000); // change to 10000

																																// periodic ping to check if connection is available
																																function beginCentralNode() {
																																	if (newCentralConnection != undefined) {
																																		newCentralConnection.ping(function (err) {
																																			const timeoutId = setTimeout(beginCentralNode, 1000);
																																			if (err) {
																																				console.log('error');
																																			} else {
																																				console.log('connected');
																																				clearTimeout(timeoutId);

																																				// recovery for central node crash
																																				node3Connection.beginTransaction(function (err) {
																																					if (err) {
																																						throw err;
																																					}

																																					console.log('Extracting log files from node 3');
																																					// query to get all log files from node 3
																																					node3Connection.query(sqlLogReadAll, function (err, result) {
																																						if (err) {
																																							node3Connection.rollback(function () {
																																								throw err;
																																							});
																																						}

																																						const node3Logs = result;
																																						// console.log('node 3 node_id 1 next trans record = ' + node3Logs[0].next_trans_record);
																																						// console.log('node 3 node_id 2 next trans record = ' + node3Logs[1].next_trans_record);
																																						// console.log('node 3 node_id 3 next trans record = ' + node3Logs[2].next_trans_record);

																																						node3Connection.commit(function (err) {
																																							if (err) {
																																								node3Connection.rollback(function () {
																																									throw err;
																																								});
																																							}
																																						
																																							newCentralConnection.query(setIsolationLevel, function (err) {
																																								if (err) {
																																									throw err;
																																								}

																																								newCentralConnection.beginTransaction(function (err) {
																																									if (err) {
																																										throw err;
																																									}

																																									// copy central log from node 3 to central node
																																									console.log('Executing query to update central log file for central node');
																																									newCentralConnection.query(sqlLogFull, [0, node3Logs[0].next_trans_record, node3Logs[0].next_trans_commit, node3Logs[0].id_new_entry, node3Logs[0].statements, 1], function (err) {
																																										if (err) {
																																											newCentralConnection.rollback(function () {
																																												throw err;
																																											});
																																										}

																																										newCentralConnection.commit(function (err) {
																																											if (err) {
																																												newCentralConnection.rollback(function () {
																																													throw err;
																																												});
																																											}

																																											node3Logs[0].next_trans_commit = node3Logs[0].next_trans_commit + 1;
																																											// get id for deletion from node 3 log
																																											let statementStr = node3Logs[0].statements.split('||| ');
																																											// console.log('Statement #' + node3Logs[0].next_trans_commit + ':' + statementStr[node3Logs[0].next_trans_commit]);
																																											statementStr = statementStr[node3Logs[0].next_trans_commit].substr(statementStr[node3Logs[0].next_trans_commit].indexOf(' ') + 1);
																																											// console.log('no number:' + statementStr);

																																											// delete id from central node
																																											console.log('Executing query to delete id from central node');
																																											newCentralConnection.query(statementStr, function (err, result) {
																																												if (err) {
																																													newCentralConnection.rollback(function () {
																																														throw err;
																																													});
																																												}

																																												newCentralConnection.commit(function (err) {
																																													if (err) {
																																														newCentralConnection.rollback(function () {
																																															throw err;
																																														});
																																													}

																																													// begin transaction to increment next_trans_commit for central log file in central node
																																													newCentralConnection.beginTransaction(function (err) {
																																														if (err) {
																																															throw err;
																																														}
																																														console.log('Executing query to update next transaction commit count of node id 1 in central node log file');
																																														newCentralConnection.query(sqlLogNextCommit, [node3Logs[0].next_trans_commit, 1], function (err, result) {
																																															if (err) {
																																																newCentralConnection.rollback(function () {
																																																	throw err;
																																																});
																																															}

																																															// console.log('Query Successful');
																																															// console.log('Committing changes');
																																															newCentralConnection.commit(function () {
																																																if (err) {
																																																	newCentralConnection.rollback(function () {
																																																		throw err;
																																																	});
																																																}

																																																console.log('Commit successful!');
																																																// begin transaction to increment next_trans_commit for central log file in node 3
																																																node3Connection.beginTransaction(function (err) {
																																																	if (err) {
																																																		throw err;
																																																	}
																																																	console.log('Executing query to update next transaction commit count of node id 1 in node 3 log file');
																																																	node3Connection.query(sqlLogNextCommit, [node3Logs[0].next_trans_commit, 1], function (err, result) {
																																																		if (err) {
																																																			node3Connection.rollback(function () {
																																																				throw err;
																																																			});
																																																		}

																																																		// console.log('Query Successful');
																																																		// console.log('Committing changes');
																																																		node3Connection.commit(function(err) {
																																																			if (err) {
																																																				node3Connection.rollback(function () {
																																																					throw err;
																																																				});
																																																			}

																																																			console.log('Commit successful!');

																																																			// copy node 3 log file from node 3 to central
																																																			newCentralConnection.beginTransaction(function (err) {
																																																				if (err) {
																																																					throw err;
																																																				}

																																																				console.log('Executing query to update node 3 log file in central node');
																																																				newCentralConnection.query(sqlLogFull, [0, node3Logs[2].next_trans_record, node3Logs[2].next_trans_commit, node3Logs[2].id_new_entry, node3Logs[2].statements, 3], function (err, result) {
																																																					if (err) {
																																																						node2Connection.rollback(function () {
																																																							throw err;
																																																						});
																																																					}

																																																					// console.log('Query Successful');
																																																					// console.log('Committing changes');
																																																					newCentralConnection.commit(function (err) {
																																																						if (err) {
																																																							node3Connection.rollback(function () {
																																																								throw err;
																																																							});
																																																						}

																																																						// copy updated log file (central and node 3 log files) to node 2
																																																						node2Connection.ping(function (err) {
																																																							if (err) {
																																																								console.log('Node 2 down');

																																																								let newNode2Connection;

																																																								// set delay before reconnecting to node 2
																																																								setTimeout(function () {
																																																									node2Pool.getConnection(function (err, connection) {
																																																										if (err) {
																																																											throw err;
																																																										}
																																																										newNode2Connection = connection;
																																																										console.log('New connection established');
																																																									});
																																																								}, 5000); // change to 10000

																																																								// periodic ping to check if connection is available
																																																								function beginNode2() {
																																																									if (newNode2Connection != undefined) {
																																																										newNode2Connection.ping(function (err) {
																																																											const timeoutId = setTimeout(beginNode2, 1000);
																																																											if (err) {
																																																												console.log('error');
																																																											} else {
																																																												console.log('connected');
																																																												clearTimeout(timeoutId);

																																																												newNode2Connection.query(setIsolationLevel, function (err) {
																																																													if (err) {
																																																														throw err;
																																																													}

																																																													// begin transaction to copy central node log to node 2
																																																													newNode2Connection.beginTransaction(function (err) {
																																																														if (err) {
																																																															throw err;
																																																														}

																																																														console.log('Executing query for node 2 update of central log file');
																																																														newNode2Connection.query(sqlLogFull, [0, node3Logs[0].next_trans_record, node3Logs[0].next_trans_commit, node3Logs[0].id_new_entry, node3Logs[0].statements, 1], function (err, result) {
																																																															if (err) {
																																																																newNode2Connection.rollback(function () {
																																																																	throw err;
																																																																});
																																																															}

																																																															newNode2Connection.commit(function (err) {
																																																																if (err) {
																																																																	newNode2Connection.rollback(function () {
																																																																		throw err;
																																																																	});
																																																																}

																																																																// begin transaction to copy node 3 log to node 2
																																																																newNode2Connection.beginTransaction(function (err) {
																																																																	if (err) {
																																																																		throw err;
																																																																	}

																																																																	console.log('Executing query for node 2 update of node 3 log file');
																																																																	newNode2Connection.query(sqlLogFull, [0, node3Logs[2].next_trans_record, node3Logs[2].next_trans_commit, node3Logs[2].id_new_entry, node3Logs[2].statements, 3], function (err, result) {
																																																																		if (err) {
																																																																			newNode2Connection.rollback(function() {
																																																																				throw err;
																																																																			});
																																																																		}

																																																																		newNode2Connection.commit(function (err) {
																																																																			if (err) {
																																																																				newNode2Connection.rollback(function() {
																																																																					throw err;
																																																																				});
																																																																			}

																																																																			// begin transaction to unlock node 3
																																																																			node3Connection.beginTransaction(function() {
																																																																				if (err) {
																																																																					throw err;
																																																																				}

																																																																				console.log('Executing query to unlock central node');
																																																																				node3Connection.query(sqlUnlockAll, function (err, result) {
																																																																					if (err) {
																																																																						node3Connection.rollback(function() {
																																																																							throw err;
																																																																						});
																																																																					}

																																																																					node3Connection.commit(function (err) {
																																																																						if (err) {
																																																																							node3Connection.rollback(function() {
																																																																								throw err;
																																																																							});
																																																																						}

																																																																						console.log('Unlock committed');
																																																																						res.send('Successfully deleted movie entry');
																																																																					});
																																																																				});
																																																																			});
																																																																		});
																																																																	});
																																																																});
																																																															});
																																																														});
																																																													});
																																																												});
																																																											}
																																																										});
																																																									} else {
																																																										setTimeout(beginNode2, 1000);
																																																										console.log('Attempting to reconnect to node');
																																																									}
																																																								}
																																																								beginNode2();
																																																							}
																																																						});
																																																					});
																																																				});
																																																			});
																																																		});
																																																	});
																																																});
																																															});
																																														});
																																													});
																																												});
																																											});
																																										});
																																									});
																																								});
																																							});
																																						});
																																					});
																																				});
																																			}
																																		});
																																	} else {
																																		setTimeout(beginCentralNode, 1000);
																																		console.log('Attempting to reconnect to node');
																																	}
																																}
																																beginCentralNode();
																															}
																														});
																													});
																												});
																											});
																										});
																									});
																								});
																							});
																						});
																					});
																				});
																			});
																		}
																	});
																}
																beginDelete();
															});
														}
													});
												});
											});
										}
									});
								});
							}
							// node 2 available
							else {
								// begin transaction to check if entry is in node 2
								node2Connection.beginTransaction(function(err){
									if(err){
										throw err;
									}

									// search for id in node 2
									node2Connection.query(sqlEntrySearch, function (err, result){
										if (err) {
											node2Connection.rollback(function (err) {
												if (err) {
													throw err;
												}
											});
										}

										// id not in node 2
										if (result[0] == undefined) {
											console.log('ID not found in node 2');
											console.log('Checking node 3');

											node3Pool.getConnection(function(err, node3Connection){
												if (err) {
													throw err;
												}

												// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy central node
												// node3Connection.destroy();

												console.log('Connecting to node 3');
												node3Connection.ping(function(err){
													if(err){
														console.log('Node 3 failed!');
														res.send('Entry is not in node 2. No entry deleted. Entry could have been in node 3 but the node is currently down. Please try again later.');
													}
													else
													{
														// begin transaction to check if entry is in node 3
														node3Connection.beginTransaction(function(err){
															if(err){
																throw err;
															}

															// search for id in node 3
															node3Connection.query(sqlEntrySearch, function (err, result){
																if (err) {
																	node3Connection.rollback(function (err) {
																		if (err) {
																			throw err;
																		}
																	});
																}

																// id not in node 3
																if (result[0] == undefined) {
																	console.log('ID not found in node 3');
																	console.log('No entry deleted');
																	res.send('Entry is not in node 2 or node 3. No entry deleted.');
																}

																// id found in node 3
																else {
																	console.log('ID found in node 3');

																	// read central log file of node 3
																	node3Connection.query(sqlLogRead1, function (err, result) {
																		if (err) throw err;
																		// console.log('lock: ' + result[0].lock_status);

																		function beginDelete() {
																			node3Connection.query(sqlLogRead1, function (err, result) {
																				let lock = result[0].lock_status;
																				const timeoutId = setTimeout(beginDelete, 1000);
																				if (lock == 1) {
																					console.log('Node locked');
																					if (timer == 100) {
																						console.log('Timeout');
																						clearTimeout(timeoutId);
																						res.send('Our servers are busy at the moment. Please try again later.');
																					}
																					timer = timer + 1;
																				} else {
																					console.log('Node free');
																					clearTimeout(timeoutId);

																					// console.log('NOT LOCKED');

																					let newStatement = `||| ${result[0].next_trans_record} ${sqlEntry}`;
																					let deleteSQL = `${sqlEntry}`;

																					// add id to statement string
																					deleteSQL = newStatement.substr(newStatement.indexOf('D'));
																					// console.log('insertsql:' + deleteSQL);

																					// update log file values
																					result[0].lock_status = 1;
																					result[0].next_trans_record = result[0].next_trans_record + 1;
																					// console.log('newstatement: ' + newStatement);

																					// console.log('before concat: ' + result[0].statements);

																					if (result[0].statements == null) result[0].statements = newStatement;
																					else result[0].statements = result[0].statements + newStatement;

																					// console.log('=======================================');
																					// console.log('STATEMENT STR: ' + result[0].statements);
																					// console.log('=======================================');

																					const resultHolder = result[0];

																					// display log file contents w/ updated fields
																					// console.log(result[0]);

																					node3Connection.beginTransaction(function (err, result) {
																						if (err) {
																							throw err;
																						}

																						console.log('Executing update log file query in node 3');
																						// update central log file in node 3
																						node3Connection.query(sqlLog, [resultHolder.lock_status, resultHolder.next_trans_record, resultHolder.statements, 1], function (err, result) {
																							if (err) {
																								node3Connection.rollback(function () {
																									throw err;
																								});
																							}

																							console.log('Executing update log file commit in node 3');
																							node3Connection.commit(function (err) {
																								if (err) {
																									node3Connection.rollback(function () {
																										throw err;
																									});
																								}

																								console.log('Update Committed');
																								// begin transaction for deleting entry in movies table
																								node3Connection.beginTransaction(function (err) {
																									if (err) {
																										throw err;
																									}

																									console.log('Executing update movies table query in node 2');
																									// query for updating movies table using web app input
																									node3Connection.query(deleteSQL, function (err, result) {
																										if (err) {
																											node3Connection.rollback(function () {
																												throw err;
																											});
																										}

																										// commit movies table update
																										console.log('Executing update movies table commit');
																										node3Connection.commit(function (err) {
																											if (err) {
																												node3Connection.rollback(function () {
																													throw err;
																												});
																											}

																											console.log('Entry Deletion Successful!');
																											// start transaction to update next_trans_commit in node 3 log file in node 3
																											node3Connection.beginTransaction(function (err) {
																												if (err) {
																													throw err;
																												}

																												node3Connection.query(sqlLogRead3, function (err, result) {
																													if (err) {
																														node3Connection.rollback(function () {
																															throw err;
																														});
																													}

																													let statementStr = resultHolder.statements.split('||| ');
																													// console.log('Statement #' + resultHolder.next_trans_record + ':' + statementStr[resultHolder.next_trans_record]);
																													statementStr = statementStr[resultHolder.next_trans_record].substr(statementStr[resultHolder.next_trans_record].indexOf(' ') + 1);
																													// console.log('no number:' + statementStr);
																													// console.log('Committing Read');

																													let node3Log = result[0];

																													newStatement = `||| ${node3Log.next_trans_record} ${statementStr}`;

																													// increment next_trans_record and next_trans_commit for node 3 log file
																													node3Log.lock_status = 1;
																													node3Log.next_trans_record = node3Log.next_trans_record + 1;
																													node3Log.next_trans_commit = node3Log.next_trans_commit + 1;

																													// console.log('new statement:' + newStatement);
																													if (node3Log.statements == null) node3Log.statements = newStatement;
																													else node3Log.statements = node3Log.statements + newStatement;

																													// console.log('node 3 statements:' + node3Log.statements);

																													node3Connection.commit(function (err) {
																														if (err) {
																															node3Connection.rollback(function () {
																																throw err;
																															});
																														}
																													});

																													console.log('Commit successful!');
																													// console.log('w/ id value:' + statementStr);
																													// console.log('delete sql:' + deleteSQL);
																													// console.log(node3Log);

																													node3Connection.beginTransaction(function (err) {
																														if (err) {
																															throw err;
																														}

																														console.log('Executing query to update log file in node 3');
																														node3Connection.query(sqlLogCommit, [node3Log.lock_status, node3Log.next_trans_record, node3Log.next_trans_commit, node3Log.statements, 3], function (err, result) {
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
																																console.log('Update to log file committed');

																																// reconnect to central node to replicate
																																centralConnection.ping(function (err) {
																																	if (err) {
																																		console.log('Central node down');
																																		let newCentralConnection;

																																		// set delay before reconnecting to node 2
																																		setTimeout(function () {
																																			centralPool.getConnection(function (err, connection) {
																																				if (err) {
																																					throw err;
																																				}
																																				newCentralConnection = connection;
																																				console.log('new connection established');
																																			});
																																		}, 5000); // change to 10000

																																		// periodic ping to check if connection is available
																																		function beginCentralNode() {
																																			if (newCentralConnection != undefined) {
																																				newCentralConnection.ping(function (err) {
																																					const timeoutId = setTimeout(beginCentralNode, 1000);
																																					if (err) {
																																						console.log('error');
																																					} else {
																																						console.log('connected');
																																						clearTimeout(timeoutId);

																																						// recovery for central node crash
																																						node3Connection.beginTransaction(function (err) {
																																							if (err) {
																																								throw err;
																																							}

																																							console.log('Extracting log files from node 3');
																																							// query to get all log files from node 3
																																							node3Connection.query(sqlLogReadAll, function (err, result) {
																																								if (err) {
																																									node3Connection.rollback(function () {
																																										throw err;
																																									});
																																								}

																																								const node3Logs = result;
																																								// console.log('node 3 node_id 1 next trans record = ' + node3Logs[0].next_trans_record);
																																								// console.log('node 3 node_id 2 next trans record = ' + node3Logs[1].next_trans_record);
																																								// console.log('node 3 node_id 3 next trans record = ' + node3Logs[2].next_trans_record);

																																								node3Connection.commit(function (err) {
																																									if (err) {
																																										node3Connection.rollback(function () {
																																											throw err;
																																										});
																																									}

																																									newCentralConnection.query(setIsolationLevel, function (err) {
																																										if (err) {
																																											throw err;
																																										}

																																										newCentralConnection.beginTransaction(function (err) {
																																											if (err) {
																																												throw err;
																																											}

																																											// copy central log from node 3 to central node
																																											console.log('Executing query to update central log file for central node');
																																											newCentralConnection.query(sqlLogFull, [0, node3Logs[0].next_trans_record, node3Logs[0].next_trans_commit, node3Logs[0].id_new_entry, node3Logs[0].statements, 1], function (err) {
																																												if (err) {
																																													newCentralConnection.rollback(function () {
																																														throw err;
																																													});
																																												}

																																												newCentralConnection.commit(function (err) {
																																													if (err) {
																																														newCentralConnection.rollback(function () {
																																															throw err;
																																														});
																																													}

																																													node3Logs[0].next_trans_commit = node3Logs[0].next_trans_commit + 1;
																																													// get id for deletion from node 3 log
																																													let statementStr = node3Logs[0].statements.split('||| ');
																																													// console.log('Statement #' + node3Logs[0].next_trans_commit + ':' + statementStr[node3Logs[0].next_trans_commit]);
																																													statementStr = statementStr[node3Logs[0].next_trans_commit].substr(statementStr[node3Logs[0].next_trans_commit].indexOf(' ') + 1);
																																													// console.log('no number:' + statementStr);

																																													// delete id from central node
																																													console.log('Executing query to delete id from central node');
																																													newCentralConnection.query(statementStr, function (err, result) {
																																														if (err) {
																																															newCentralConnection.rollback(function () {
																																																throw err;
																																															});
																																														}

																																														newCentralConnection.commit(function (err) {
																																															if (err) {
																																																newCentralConnection.rollback(function () {
																																																	throw err;
																																																});
																																															}

																																															// begin transaction to increment next_trans_commit for central log file in central node
																																															newCentralConnection.beginTransaction(function (err) {
																																																if (err) {
																																																	throw err;
																																																}
																																																console.log('Executing query to update next transaction commit count of node id 1 in central node log file');
																																																newCentralConnection.query(sqlLogNextCommit, [node3Logs[0].next_trans_commit, 1], function (err, result) {
																																																	if (err) {
																																																		newCentralConnection.rollback(function () {
																																																			throw err;
																																																		});
																																																	}

																																																	// console.log('Query Successful');
																																																	// console.log('Committing changes');
																																																	newCentralConnection.commit(function () {
																																																		if (err) {
																																																			newCentralConnection.rollback(function () {
																																																				throw err;
																																																			});
																																																		}

																																																		console.log('Commit successful!');
																																																		// begin transaction to increment next_trans_commit for central log file in node 3
																																																		node3Connection.beginTransaction(function (err) {
																																																			if (err) {
																																																				throw err;
																																																			}
																																																			console.log('Executing query to update next transaction commit count of node id 1 in node 3 log file');
																																																			node3Connection.query(sqlLogNextCommit, [node3Logs[0].next_trans_commit, 1], function (err, result) {
																																																				if (err) {
																																																					node3Connection.rollback(function () {
																																																						throw err;
																																																					});
																																																				}

																																																				// console.log('Query Successful');
																																																				// console.log('Committing changes');
																																																				node3Connection.commit(function (err) {
																																																					if (err) {
																																																						node3Connection.rollback(function () {
																																																							throw err;
																																																						});
																																																					}

																																																					console.log('Commit successful!');

																																																					// copy node 3 log file from node 3 to central
																																																					newCentralConnection.beginTransaction(function (err) {
																																																						if (err) {
																																																							throw err;
																																																						}

																																																						console.log('Executing query to update node 3 log file in central node');
																																																						newCentralConnection.query(sqlLogFull, [0, node3Logs[2].next_trans_record, node3Logs[2].next_trans_commit, node3Logs[2].id_new_entry, node3Logs[2].statements, 3], function (err, result) {
																																																							if (err) {
																																																								node2Connection.rollback(function () {
																																																									throw err;
																																																								});
																																																							}

																																																							// console.log('Query Successful');
																																																							// console.log('Committing changes');
																																																							newCentralConnection.commit(function (err) {
																																																								if (err) {
																																																									node3Connection.rollback(function () {
																																																										throw err;
																																																									});
																																																								}

																																																								// copy updated log file (central and node 3 log files) to node 3
																																																								// begin transaction to copy central node log to node 2
																																																								node2Connection.beginTransaction(function (err) {
																																																									if (err) {
																																																										throw err;
																																																									}

																																																									console.log('Executing query for node 2 update of central log file');
																																																									node2Connection.query(sqlLogFull, [0, node3Logs[0].next_trans_record, node3Logs[0].next_trans_commit, node3Logs[0].id_new_entry, node3Logs[0].statements, 1], function (err, result) {
																																																										if (err) {
																																																											node2Connection.rollback(function () {
																																																												throw err;
																																																											});
																																																										}

																																																										node2Connection.commit(function (err) {
																																																											if (err) {
																																																												node2Connection.rollback(function () {
																																																													throw err;
																																																												});
																																																											}

																																																											// begin transaction to copy node 3 log to node 2
																																																											node2Connection.beginTransaction(function (err) {
																																																												if (err) {
																																																													throw err;
																																																												}

																																																												console.log('Executing query for node 2 update of node 3 log file');
																																																												node2Connection.query(sqlLogFull, [0, node3Logs[2].next_trans_record, node3Logs[2].next_trans_commit, node3Logs[2].id_new_entry, node3Logs[2].statements, 3], function (err, result) {
																																																													if (err) {
																																																														node2Connection.rollback(function() {
																																																															throw err;
																																																														});
																																																													}

																																																													node2Connection.commit(function (err) {
																																																														if (err) {
																																																															node2Connection.rollback(function() {
																																																																throw err;
																																																															});
																																																														}

																																																														// begin transaction to unlock node 3
																																																														node3Connection.beginTransaction(function() {
																																																															if (err) {
																																																																throw err;
																																																															}

																																																															console.log('Executing query to unlock central node');
																																																															node3Connection.query(sqlUnlockAll, function (err, result) {
																																																																if (err) {
																																																																	node3Connection.rollback(function() {
																																																																		throw err;
																																																																	});
																																																																}

																																																																node3Connection.commit(function (err) {
																																																																	if (err) {
																																																																		node3Connection.rollback(function() {
																																																																			throw err;
																																																																		});
																																																																	}

																																																																	console.log('Unlock committed');
																																																																	res.send('Successfully deleted movie entry');
																																																																});
																																																															});
																																																														});
																																																													});
																																																												});
																																																											});
																																																										});
																																																									});
																																																								});
																																																							});
																																																						});
																																																					});
																																																				});
																																																			});
																																																		});
																																																	});
																																																});
																																															});
																																														});
																																													});
																																												});
																																											});
																																										});
																																									});
																																								});
																																							});
																																						});
																																					}
																																				});
																																			} else {
																																				setTimeout(beginCentralNode, 1000);
																																				console.log('Attempting to reconnect to node');
																																			}
																																		}
																																		beginCentralNode();
																																	}
																																});
																															});
																														});
																													});
																												});
																											});
																										});
																									});
																								});
																							});
																						});
																					});
																				}
																			});
																		}
																		beginDelete();
																	});
																}
															});
														})
													}
												})
											})
										}

										// id in node 2
										else{
											console.log("ID in node 2");

											node2Connection.query(setIsolationLevel, function (err) {
												if (err) {
													throw err;
												}

												node2Connection.query(sqlLogRead2, function(err, result){
													if(err) throw err;
													// console.log('lock: ' + result[0].lock_status);
													function beginDelete() {
														node2Connection.query(sqlLogRead2, function(err, result){
															let lock = result[0].lock_status;
															const timeoutId = setTimeout(beginDelete, 1000);
															if (lock == 1) {
																console.log('Node locked');
																if (timer == 100) {
																	console.log('Timeout');
																	clearTimeout(timeoutId);
																	res.send('Our servers are busy at the moment. Please try again later.');
																}
																timer = timer + 1;
															} else{
																console.log('Node free');
																clearTimeout(timeoutId);

																// console.log('NOT LOCKED');

																let newStatement = `||| ${result[0].next_trans_record} ${sqlEntry}`;
																let deleteSQL = `${sqlEntry}`;

																// console.log('insertsql:' + deleteSQL);

																// update log file values
																result[0].lock_status = 1;
																result[0].next_trans_record = result[0].next_trans_record + 1;
																// console.log('newstatement: ' + newStatement);

																// console.log('before concat: ' + result[0].statements);

																if (result[0].statements == null) result[0].statements = newStatement;
																else result[0].statements = result[0].statements + newStatement;

																// console.log('=======================================');
																// console.log('STATEMENT STR: ' + result[0].statements);
																// console.log('=======================================');

																const node2Log = result[0];

																// display log file contents w/ updated fields
																// console.log(result[0]);

																// begin transaction to update node 2 log file in node 2
																node2Connection.beginTransaction(function(err, result){
																	if (err) {
																		throw err;
																	}

																	console.log('Executing query to update node 2 log file in node 2');
																	// update central log file in node 2
																	node2Connection.query(sqlLog, [node2Log.lock_status, node2Log.next_trans_record, node2Log.statements, 2], function (err, result){
																		if (err) {
																			node2Connection.rollback(function () {
																				throw err;
																			});
																		}

																		node2Connection.commit(function(err){
																			if (err) {
																				node2Connection.rollback(function () {
																					throw err;
																				});
																			}

																			console.log('Update Committed');
																			
																			// begin transaction to read log file in node 2
																			node2Connection.beginTransaction(function(err){
																				if(err){
																					throw err;
																				}

																				console.log('Executing read central log file query in node 2');
																				node2Connection.query(sqlLogRead1, function (err, result){
																					if(err){
																						node2Connection.rollback(function () {
																							throw err;
																						});
																					}

																					let statementStr = node2Log.statements.split('||| ');
																					// console.log('Statement #' + node2Log.next_trans_record + ':' + statementStr[node2Log.next_trans_record]);
																					statementStr = statementStr[node2Log.next_trans_record].substr(statementStr[node2Log.next_trans_record].indexOf(' ') + 1);
																					// console.log('no number:' + statementStr);
																					// console.log('Committing Read');

																					let centralLog = result[0];

																					newStatement = `||| ${centralLog.next_trans_record} ${statementStr}`;

																					// increment next_trans_record and next_trans_commit for node 3 log file
																					centralLog.lock_status = 1;
																					centralLog.next_trans_record = centralLog.next_trans_record + 1;
																					centralLog.next_trans_commit = centralLog.next_trans_commit + 1;

																					// console.log('new statement:' + newStatement);
																					if (centralLog.statements == null) centralLog.statements = newStatement;
																					else centralLog.statements = centralLog.statements + newStatement;

																					node2Connection.commit(function (err) {
																						if (err) {
																							node2Connection.rollback(function () {
																								throw err;
																							});
																						}
																						
																						console.log('Commit successful!');
																						// console.log(centralLog);

																						// begin transaction to update central log file in node 2
																						node2Connection.beginTransaction(function(err){
																							if(err){
																								throw err;
																							}

																							console.log('Executing query to update central log file in node 2');
																							node2Connection.query(sqlLog, [centralLog.lock_status, centralLog.next_trans_record, centralLog.statements, 1], function (err, result){
																								if(err){
																									node2Connection.rollback(function () {
																										throw err;
																									});
																								}

																								node2Connection.commit(function(err){
																									if (err) {
																										node2Connection.rollback(function () {
																											throw err;
																										});
																									}
																									console.log("Commit successful!");

																									// begin transaction to delete entry from node 2
																									node2Connection.beginTransaction(function(err){
																										if(err){
																											throw err;
																										}

																										console.log('Executing query to delete entry from node 2');
																										node2Connection.query(statementStr, function(err, result){
																											if(err){
																												node2Connection.rollback(function () {
																													throw err;
																												});
																											}

																											node2Connection.commit(function(err){
																												if(err){
																													node2Connection.rollback(function(){
																														throw err;
																													})
																												}

																												node2Log.next_trans_commit = node2Log.next_trans_commit + 1;
																												console.log("Successfully deleted from node 2!");

																												// update central log file next commit value in node 2
																												node2Connection.beginTransaction(function(err){
																													if(err){
																														throw err;
																													}
																													
																													console.log('Executing query to update next transaction commit count of node id 2 in node 2 log file');
																													node2Connection.query(sqlLogNextCommit, [node2Log.next_trans_commit, 2], function(err, result){
																														if (err) {
																															node2Connection.rollback(function () {
																																throw err;
																															});
																														}

																														node2Connection.commit(function(err){
																															if(err){
																																newCentralConnection.rollback(function () {
																																	throw err;
																																});
																															}

																															console.log("Updated node 2 log file!");

																															// reconnect to central node to replicate
																															centralConnection.ping(function(err){
																																if(err){
																																	console.log('Central node down');
																																	let newCentralConnection;

																																	// set delay before reconnecting to node 2
																																	setTimeout(function () {
																																		centralPool.getConnection(function (err, connection) {
																																			if (err) {
																																				throw err;
																																			}
																																			newCentralConnection = connection;
																																			console.log('new connection established');
																																		});
																																	}, 5000); // change to 10000

																																	// periodic ping to check if connection is available
																																	function beginCentralNode() {
																																		if (newCentralConnection != undefined){
																																			newCentralConnection.ping(function(err){
																																				if(err){
																																					console.log('error');
																																				}
																																				else{
																																					console.log('connected');
																																					clearTimeout(timeoutId);

																																					// recovery for central node crash
																																					node2Connection.beginTransaction(function(err){
																																						if(err){
																																							throw err;
																																						}

																																						console.log('Extracting log files from node 3');
																																						// query to get all log files from node 3
																																						node2Connection.query(sqlLogReadAll, function (err, result){
																																							if(err){
																																								node2Connection.rollback(function () {
																																									throw err;
																																								});
																																							}

																																							const allNode2Logs = result;
																																							// console.log('node 2 node_id 1 next trans record = ' + allNode2Logs[0].next_trans_record);
																																							// console.log('node 2 node_id 2 next trans record = ' + allNode2Logs[1].next_trans_record);
																																							// console.log('node 2 node_id 3 next trans record = ' + allNode2Logs[2].next_trans_record);

																																							node2Connection.commit(function(err){
																																								if (err) {
																																									node2Connection.rollback(function () {
																																										throw err;
																																									});
																																								}

																																								newCentralConnection.query(setIsolationLevel, function (err) {
																																									if (err) {
																																										throw err;
																																									}

																																									newCentralConnection.beginTransaction(function(err){
																																										if (err) {
																																											throw err;
																																										}

																																										// copy central log from node 2 to central node
																																										console.log('Executing query to update central log file for central node');
																																										newCentralConnection.query(sqlLogFull, [0, allNode2Logs[0].next_trans_record, allNode2Logs[0].next_trans_commit, allNode2Logs[0].id_new_entry, allNode2Logs[0].statements, 1], function (err){
																																											if (err) {
																																												newCentralConnection.rollback(function () {
																																													throw err;
																																												});
																																											}

																																											newCentralConnection.commit(function(err){
																																												if (err) {
																																													newCentralConnection.rollback(function () {
																																														throw err;
																																													});
																																												}

																																												console.log("Log file updated!");

																																												// copy node 2 log from node 2 to central node
																																												newCentralConnection.beginTransaction(function(err){
																																													if (err) {
																																														throw err;
																																													}
					
																																													// copy node 2 log from node 2 to central node
																																													console.log('Executing query to update central log file for central node');
																																													newCentralConnection.query(sqlLogFull, [0, allNode2Logs[1].next_trans_record, allNode2Logs[1].next_trans_commit, allNode2Logs[1].id_new_entry, allNode2Logs[1].statements, 2], function (err){
																																														if (err) {
																																															newCentralConnection.rollback(function () {
																																																throw err;
																																															});
																																														}
					
																																														newCentralConnection.commit(function(err){
																																															if (err) {
																																																newCentralConnection.rollback(function () {
																																																	throw err;
																																																});
																																															}
					
																																															console.log("Log file updated!");
					
																																															// get statement for deletion from node 3 log
																																															allNode2Logs[0].next_trans_commit = allNode2Logs[0].next_trans_commit + 1;
																																															
																																															let statementStr = allNode2Logs[0].statements.split('||| ');
																																															// console.log('Statement #' + allNode2Logs[0].next_trans_commit + ':' + statementStr[allNode2Logs[0].next_trans_commit]);
																																															statementStr = statementStr[allNode2Logs[0].next_trans_commit].substr(statementStr[allNode2Logs[0].next_trans_commit].indexOf(' ') + 1);
																																															// console.log('no number:' + statementStr);
																																															
																																															// delete entry from central node
																																															newCentralConnection.beginTransaction(function(err){
																																																if (err) {
																																																	throw err;
																																																}

																																																console.log("Executing query to delete entry from central node")
																																																newCentralConnection.query(statementStr, function (err, result){
																																																	if (err) {
																																																		newCentralConnection.rollback(function () {
																																																			throw err;
																																																		});
																																																	}

																																																	newCentralConnection.commit(function(err){
																																																		if(err){
																																																			newCentralConnection.rollback(function () {
																																																				throw err;
																																																			});
																																																		}

																																																		console.log("Successfully deleted from central node!");

																																																		// update central log file next commit value in central node
																																																		newCentralConnection.beginTransaction(function(err){
																																																			if(err){
																																																				throw err;
																																																			}

																																																			console.log('Executing query to update next transaction commit count of node id 1 in central node log file');
																																																			newCentralConnection.query(sqlLogNextCommit, [allNode2Logs[0].next_trans_commit, 1], function (err, result){
																																																				if (err) {
																																																					newCentralConnection.rollback(function () {
																																																						throw err;
																																																					});
																																																				}

																																																				// console.log('Query Successful');
																																																				// console.log('Committing changes');
																																																				newCentralConnection.commit(function(){
																																																					if (err) {
																																																						newCentralConnection.rollback(function () {
																																																							throw err;
																																																						});
																																																					}

																																																					console.log('Commit successful!');
																																																					// begin transaction to increment next_trans_commit for central log file in node 3
																																																					node2Connection.beginTransaction(function(err){
																																																						if(err){
																																																							throw err;
																																																						}

																																																						console.log('Executing query to update next transaction commit count of node id 1 in node 2 log file');
																																																						node2Connection.query(sqlLogNextCommit, [allNode2Logs[0].next_trans_commit, 1], function (err, result){
																																																							if (err) {
																																																								node2Connection.rollback(function () {
																																																									throw err;
																																																								});
																																																							}

																																																							// console.log('Query Successful');
																																																							// console.log('Committing changes');
																																																							node2Connection.commit(function(err){
																																																								if (err) {
																																																									node2Connection.rollback(function () {
																																																										throw err;
																																																									});
																																																								}

																																																								console.log('Commit successful!');

																																																								// copy updated log file (central and node 2 log files) to node 3
																																																								node3Pool.getConnection(function(err, node3Connection){
																																																									if(err){
																																																										throw err;
																																																									}

																																																									node3Connection.ping(function(err){
																																																										if(err){
																																																											throw err;
																																																										}
																																																										else{
																																																											node3Connection.query(setIsolationLevel, function (err) {
																																																												if (err) {
																																																													throw err;
																																																												}

																																																												// begin transaction to copy central node log to node 3
																																																												node3Connection.beginTransaction(function(err){
																																																													if(err){
																																																														throw err;
																																																													}

																																																													console.log('Executing query for node 3 update of central log file');
																																																													node3Connection.query(sqlLogFull, [0, allNode2Logs[0].next_trans_record, allNode2Logs[0].next_trans_commit, allNode2Logs[0].id_new_entry, allNode2Logs[0].statements, 1], function (err, result){
																																																														if (err) {
																																																															node3Connection.rollback(function () {
																																																																throw err;
																																																															});
																																																														}

																																																														node3Connection.commit(function(err){
																																																															if(err){
																																																																node3Connection.rollback(function () {
																																																																	throw err;
																																																																});
																																																															}

																																																															console.log("Central log file in node 3 updated!");

																																																															// begin transaction to copy node 2 log to node 3
																																																															node3Connection.beginTransaction(function(err){
																																																																if(err){
																																																																	throw err;
																																																																}

																																																																console.log('Executing query for node 3 update of central log file');
																																																																node3Connection.query(sqlLogFull, [0, allNode2Logs[1].next_trans_record, allNode2Logs[1].next_trans_commit, allNode2Logs[1].id_new_entry, allNode2Logs[1].statements, 2], function (err, result){
																																																																	if (err) {
																																																																		node3Connection.rollback(function () {
																																																																			throw err;
																																																																		});
																																																																	}

																																																																	node3Connection.commit(function(err){
																																																																		if(err){
																																																																			node3Connection.rollback(function () {
																																																																				throw err;
																																																																			});
																																																																		}
																																																																		
																																																																		console.log("Central log file in node 3 updated!");

																																																																		// begin transaction to unlock node 2
																																																																		node2Connection.beginTransaction(function(){
																																																																			if(err){
																																																																				throw err;
																																																																			}

																																																																			console.log('Executing query to unlock central node');
																																																																			node2Connection.query(sqlUnlockAll, function (err, result){
																																																																				if (err) {
																																																																					node2Connection.rollback(function() {
																																																																						throw err;
																																																																					});
																																																																				}

																																																																				node2Connection.commit(function(err){
																																																																					if (err) {
																																																																						node3Connection.rollback(function() {
																																																																							throw err;
																																																																						});
																																																																					}

																																																																					console.log('Unlock committed');
																																																																					res.send('Successfully deleted movie entry');
																																																																				})
																																																																			})
																																																																		})
																																																																	})
																																																																})
																																																															})
																																																														})
																																																													})
																																																												})
																																																											});
																																																										}
																																																									})
																																																								})
																																																							})
																																																						})
																																																					})
																																																				})
																																																			})
																																																		})
																																																	})
																																																})
																																															})
																																														})
																																													})
																																												})
																																											})
																																										})
																																									})
																																								});
																																							})
																																						})
																																					})
																																				}
																																			})
																																		}
																																		else
																																		{
																																			setTimeout(beginCentralNode, 1000);
																																			console.log('Attempting to reconnect to node');
																																		}
																																	}
																																	beginCentralNode();
																																}
																															})

																														})
																													})
																												})
																											})
																										})
																									})
																								})
																							})
																						})
																					});
																				});
																			})
																		})
																	})
																})
															}
														})
													}
													beginDelete();
												})
											});
										}
									})
								})
							}
						});
					});
				}
				// central node available
				else {
					// search for the id in the central node
					centralConnection.beginTransaction(function(err){
						if (err) {
							throw err;
						}
						
						console.log("Executing query to search for entry in the central node");
						centralConnection.query(sqlEntrySearch, function (err, result){
							if (err) {
								centralConnection.rollback(function (err) {
									if (err) {
										throw err;
									}
								});
							}

							// id not in central node
							if (result[0] == undefined) {
								console.log('ID not found in the central node');
								console.log('No entry deleted');
								res.send('ID not in the database. No entry deleted.');
							}
							else{
								console.log('ID found in the central node');

								// read central log file of central node
								centralPool.getConnection(function (err, centralConnection2) {
									if (err) {
										throw err;
									}
		
									centralConnection2.query(setIsolationLevel, function (err) {
										if (err) {
											throw err;
										}

										centralConnection2.query(sqlLogRead1, function (err, result) {
											if (err) throw err;
											// console.log('lock: ' + result[0].lock_status);
		
											function beginDelete() {
												centralConnection2.query(sqlLogReadAll, function (err, result) {
													let lock = result[0].lock_status;
													const timeoutId = setTimeout(beginDelete, 1000);
													if (lock == 1) {
														if (timer == 100) {
															console.log('Timeout');
															clearTimeout(timeoutId);
															res.send('Our servers are busy at the moment. Please try again later.');
														}
														console.log('Node locked');
														timer = timer + 1;
													}
													else{
														console.log('Node free');
														clearTimeout(timeoutId);

														// console.log('NOT LOCKED');

														let newStatement = `||| ${result[0].next_trans_record} ${sqlEntry}`;
														let deleteSQL = `${sqlEntry}`;

														// add id to statement string
														deleteSQL = newStatement.substr(newStatement.indexOf('D'));
														// console.log('insertsql:' + deleteSQL);

														// update log file values
														result[0].lock_status = 1;
														result[0].next_trans_record = result[0].next_trans_record + 1;
														// console.log('newstatement: ' + newStatement);

														// console.log('before concat: ' + result[0].statements);

														if (result[0].statements == null) result[0].statements = newStatement;
														else result[0].statements = result[0].statements + newStatement;

														// console.log('=======================================');
														// console.log('STATEMENT STR: ' + result[0].statements);
														// console.log('=======================================');

														const resultHolder = result;

														// display log file contents w/ updated fields
														// console.log(result[0]);

														// update central log file in central node
														centralConnection2.beginTransaction(function(err){
															if(err){
																throw err;
															}

															console.log("Executing query to update central log file in central node");
															centralConnection2.query(sqlLog, [resultHolder[0].lock_status, resultHolder[0].next_trans_record, resultHolder[0].statements, 1], function (err, result){
																if(err){
																	centralConnection2.rollback(function(){
																		throw err;
																	})
																}

																centralConnection2.commit(function(err){
																	if(err){
																		centralConnection2.rollback(function(){
																			throw err;
																		})
																	}

																	console.log("Log file update committed!");

																	// get year of id to determine log file to update
																	centralConnection2.beginTransaction(function(err){
																		if(err){
																			throw err;
																		}

																		console.log("Executing query to search central node for year of entry")
																		centralConnection2.query(sqlEntrySearch, function(err, result){
																			if(err){
																				centralConnection2.rollback(function() {
																					throw err;
																				});
																			}

																			centralConnection2.commit(function(err){
																				if(err){
																					centralConnection2.rollback(function () {
																						throw err;
																					});
																				}

																				const year = result[0].year;

																				// console.log("YEAR: " + year);

																				// if year < 1980 delete in node 2
																				if(year < 1980){
																					centralConnection2.beginTransaction(function(err){
																						if(err){
																							throw err;
																						}

																						let newStatement = `||| ${resultHolder[1].next_trans_record} ${sqlEntry}`;
																						let deleteSQL = `${sqlEntry}`;

																						// add id to statement string
																						deleteSQL = newStatement.substr(newStatement.indexOf('D'));
																						// console.log('deletesql:' + deleteSQL);

																						// update log file values
																						resultHolder[1].lock_status = 1;
																						resultHolder[1].next_trans_record = resultHolder[1].next_trans_record + 1;
																						// console.log('newstatement: ' + newStatement);

																						// console.log('before concat: ' + resultHolder[1].statements);

																						if (resultHolder[1].statements == null) resultHolder[1].statements = newStatement;
																						else resultHolder[1].statements = resultHolder[1].statements + newStatement;

																						// console.log('=======================================');
																						// console.log('STATEMENT STR: ' + resultHolder[1].statements);
																						// console.log('=======================================');

																						// display log file contents w/ updated fields
																						// console.log(resultHolder[1]);

																						centralConnection2.query(sqlLog, [resultHolder[1].lock_status, resultHolder[1].next_trans_record, resultHolder[1].statements, 2], function (err, result){
																							if(err){
																								centralConnection2.rollback(function () {
																									throw err;
																								});
																							}

																							centralConnection2.commit(function(err){
																								if(err){
																									centralConnection2.rollback(function () {
																										throw err;
																									});
																								}


																								// delete entry from central node
																								centralConnection2.beginTransaction(function(err){
																									if(err){
																										throw err;
																									}

																									console.log("Executing query to delete entry from central node");
																									centralConnection2.query(deleteSQL, function(err, result){
																										if(err){
																											centralConnection2.rollback(function(){
																												throw err;
																											})
																										}

																										centralConnection2.commit(function(err){
																											if(err){
																												centralConnection2.rollback(function(){
																													throw err;
																												})
																											}

																											console.log("Successfully deleted entry!");

																											// update central log file in central node
																											centralConnection2.beginTransaction(function(err){
																												if(err){
																													throw err;
																												}

																												resultHolder[0].next_trans_commit = resultHolder[0].next_trans_commit + 1;

																												console.log("Executing query to update next transaction commit count of central log file in central node");
																												centralConnection2.query(sqlLogNextCommit, [resultHolder[0].next_trans_commit, 1], function(err, result){
																													if(err){
																														centralConnection2.rollback(function(){
																															throw err;
																														})
																													}


																													// update log file in node 2 using central node log files
																													centralConnection2.commit(function(err){
																														if(err){
																															centralConnection2.rollback(function(){
																																throw err;
																															})
																														}

																														// connect to node 2
																														node2Pool.getConnection(function(err, node2Connection){
																															if(err){
																																throw err;
																															}

																															// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy node 2
																															// node2Connection.destroy();

																															console.log('Connecting to node 2');
																															node2Connection.ping(function(err){
																																// node 2 failed
																																if(err){
																																	console.log('Node 2 failed!');
																																	let newNode2Connection;

																																	// set delay before reconnecting to node 2
																																	setTimeout(function () {
																																		node2Pool.getConnection(function (err, connection) {
																																			if (err) {
																																				throw err;
																																			}
																																			newNode2Connection = connection;
																																			console.log('new connection established');
																																		});
																																	}, 5000); // change to 10000

																																	// periodic ping to check if connection is available
																																	function beginNode2(){
																																		if (newNode2Connection != undefined){
																																			newNode2Connection.ping(function(err){
																																				const timeoutId = setTimeout(beginNode2, 1000);
																																				if (err) {
																																					console.log('error');
																																				} 
																																				else
																																				{
																																					console.log('connected');
																																					clearTimeout(timeoutId);

																																					// replication for node 2
																																					centralConnection2.beginTransaction(function(err){
																																						if(err){
																																							throw err;
																																						}
																																						
																																						centralConnection2.query(sqlLogReadAll, function(err, result){
																																							if(err){
																																								centralConnection2.rollback(function () {
																																									throw err;
																																								});
																																							}

																																							const centralLogs = result;
																																							// console.log('central node_id 1 next trans record = ' + centralLogs[0].next_trans_record);
																																							// console.log('central node_id 2 next trans record = ' + centralLogs[1].next_trans_record);
																																							// console.log('central node_id 3 next trans record = ' + centralLogs[2].next_trans_record);

																																							centralConnection2.commit(function(err){
																																								if (err) {
																																									centralConnection2.rollback(function () {
																																										throw err;
																																									});
																																								}

																																								node3Pool.getConnection(function(err, node3Connection){
																																									if(err){
																																										throw err;
																																									}

																																									node3Connection.ping(function(err){
																																										// node 3 failed
																																										if(err){
																																											console.log("Node 3 failed!");
																																										}
																																										// node 3 available
																																										else
																																										{
																																											console.log("Node 3 available!");

																																											node3Connection.query(setIsolationLevel, function (err) {
																																												if (err) {
																																													throw err;
																																												}

																																												node3Connection.beginTransaction(function(err){
																																													if (err) {
																																														throw err;
																																													}

																																													// query to get log files from node 3
																																													node3Connection.query(sqlLogReadAll, function(err, result){
																																														if (err) {
																																															node3Connection.rollback(function () {
																																																throw err;
																																															});
																																														}

																																														const node3Logs = result;
																																														// console.log('node 3 node_id 1 next trans record = ' + node3Logs[0].next_trans_record);
																																														// console.log('node 3 node_id 2 next trans record = ' + node3Logs[1].next_trans_record);
																																														// console.log('node 3 node_id 3 next trans record = ' + node3Logs[2].next_trans_record);

																																														node3Connection.commit(function(err){
																																															if(err){
																																																node3Connection.rollback(function () {
																																																	throw err;
																																																});
																																															}

																																															let finalNodeLogs = centralLogs;
																																															if (centralLogs[0].next_trans_record < node3Logs[0].next_trans_record) {
																																																finalNodeLogs[0] = node3Logs[0];
																																															}
																																															if (centralLogs[1].next_trans_record < node3Logs[1].next_trans_record) {
																																																finalNodeLogs[1] = node3Logs[1];
																																															}
																																															if (centralLogs[2].next_trans_record < node3Logs[2].next_trans_record) {
																																																finalNodeLogs[2] = node3Logs[2];
																																															}

																																															// console.log('final next trans record = ' + finalNodeLogs[0].next_trans_record);
																																															// console.log('final next trans record = ' + finalNodeLogs[1].next_trans_record);
																																															// console.log('final next trans record = ' + finalNodeLogs[2].next_trans_record);

																																															newNode2Connection.query(setIsolationLevel, function (err) {
																																																if (err) {
																																																	throw err;
																																																}

																																																// begin transaction to update log file in node 2
																																																newNode2Connection.beginTransaction(function(err){
																																																	if (err) {
																																																		throw err;
																																																	}

																																																	// update node 2 central log file to match central node
																																																	console.log('Executing query for node 2 update of central log file');
																																																	newNode2Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																																		if (err) {
																																																			newNode2Connection.rollback(function () {
																																																				throw err;
																																																			});
																																																		}

																																																		// commit node 2 log file of node id 1
																																																		console.log('Committing node 2 update for central log file');
																																																		newNode2Connection.commit(function(err){
																																																			if (err) {
																																																				newNode2Connection.rollback(function () {
																																																					throw err;
																																																				});
																																																			}

																																																			console.log('Commit success');

																																																			newNode2Connection.beginTransaction(function(err){
																																																				if (err) {
																																																					throw err;
																																																				}

																																																				// commit node 2 log file update of node id 2
																																																				console.log('Committing node 2 update for node 2 log file');
																																																				newNode2Connection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result){
																																																					if (err) {
																																																						newNode2Connection.rollback(function () {
																																																							throw err;
																																																						});
																																																					}

																																																					newNode2Connection.commit(function(err){
																																																						if (err) {
																																																							newNode2Connection.rollback(function () {
																																																								throw err;
																																																							});
																																																						}

																																																						console.log('Commit success');

																																																						// get statement from node 2 log
																																																						finalNodeLogs[1].next_trans_commit = finalNodeLogs[1].next_trans_commit + 1;
																																																						// get id for deletion from node 2 log
																																																						let statementStr = finalNodeLogs[1].statements.split('||| ');
																																																						// console.log('Statement #' + finalNodeLogs[1].next_trans_commit + ':' + statementStr[finalNodeLogs[1].next_trans_commit]);
																																																						statementStr = statementStr[finalNodeLogs[1].next_trans_commit].substr(statementStr[finalNodeLogs[1].next_trans_commit].indexOf(' ') + 1);
																																																						// console.log('no number:' + statementStr);

																																																						// delete id from central node
																																																						newNode2Connection.beginTransaction(function(err){
																																																							if (err) {
																																																								throw err;
																																																							}

																																																							console.log('Executing query to delete id from node 2');
																																																							newNode2Connection.query(statementStr, function(err, result){
																																																								if (err) {
																																																									newNode2Connection.rollback(function () {
																																																										throw err;
																																																									});
																																																								}

																																																								newNode2Connection.commit(function(err){
																																																									if (err) {
																																																										newNode2Connection.rollback(function () {
																																																											throw err;
																																																										});
																																																									}

																																																									console.log("Successfully deleted from node 2!");

																																																									// begin transaction to increment next_trans_commit for node 2 log file in node 2
																																																									newNode2Connection.beginTransaction(function(err){
																																																										if(err){
																																																											throw err;
																																																										}

																																																										console.log('Executing query to update next transaction commit count of node id 2 in node 2 log file');
																																																										newNode2Connection.query(sqlLogNextCommit, [finalNodeLogs[1].next_trans_commit, 2], function (err, result){
																																																											if (err) {
																																																												newNode2Connection.rollback(function () {
																																																													throw err;
																																																												});
																																																											}

																																																											newNode2Connection.commit(function(){
																																																												if(err){
																																																													newNode2Connection.rollback(function () {
																																																														throw err;
																																																													});
																																																												}
																																																												console.log('Log file update commit in node 2 successful!');
																																																												
																																																												// begin transaction to increment next_trans_commit for node 2 log file in central node
																																																												centralConnection2.beginTransaction(function(err){
																																																													if (err) {
																																																														throw err;
																																																													}

																																																													console.log('Executing query to update next transaction commit count of central node in central log file');
																																																													centralConnection2.query(sqlLogNextCommit, [finalNodeLogs[1].next_trans_commit, 2], function (err, result){
																																																														if (err) {
																																																															centralConnection2.rollback(function () {
																																																																throw err;
																																																															});
																																																														}

																																																														centralConnection2.commit(function(err){
																																																															if (err) {
																																																																centralConnection2.rollback(function () {
																																																																	throw err;
																																																																});
																																																															}

																																																															console.log('Log file update in central node successful!');

																																																															// begin transaction to copy central node log file to node 3
																																																															node3Connection.beginTransaction(function(err){
																																																																if(err){
																																																																	throw err;
																																																																}

																																																																console.log('Executing query for node 3 update of central log file');
																																																																node3Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																																																	if (err) {
																																																																		node3Connection.rollback(function () {
																																																																			throw err;
																																																																		});
																																																																	}

																																																																	node3Connection.commit(function(err){
																																																																		if (err) {
																																																																			node3Connection.rollback(function () {
																																																																				throw err;
																																																																			});
																																																																		}

																																																																		console.log("Log file update in node 3 successful!");

																																																																		// begin transaction to copy node 2 log file to node 3
																																																																		node3Connection.beginTransaction(function(err){
																																																																			if(err){
																																																																				throw err;
																																																																			}

																																																																			console.log('Executing query for node 3 update of node 2 log file');
																																																																			node3Connection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result){
																																																																				if (err) {
																																																																					node3Connection.rollback(function () {
																																																																						throw err;
																																																																					});
																																																																				}

																																																																				node3Connection.commit(function(err){
																																																																					if (err) {
																																																																						node3Connection.rollback(function () {
																																																																							throw err;
																																																																						});
																																																																					}

																																																																					// begin transaction to unlock node 3
																																																																					centralConnection2.beginTransaction(function() {
																																																																						if (err) {
																																																																							throw err;
																																																																						}

																																																																						console.log('Executing query to unlock central node');
																																																																						centralConnection2.query(sqlUnlockAll, function (err, result) {
																																																																							if (err) {
																																																																								centralConnection2.rollback(function() {
																																																																									throw err;
																																																																								});
																																																																							}

																																																																							centralConnection2.commit(function (err) {
																																																																								if (err) {
																																																																									centralConnection2.rollback(function() {
																																																																										throw err;
																																																																									});
																																																																								}

																																																																								console.log('Unlock committed');
																																																																								res.send('Successfully deleted movie entry');
																																																																							});
																																																																						});
																																																																					});
																																																																				})
																																																																			})
																																																																		})
																																																																	})
																																																																})
																																																															})
																																																														})
																																																													})
																																																												})
																																																											})
																																																										})
																																																									})
																																																								})
																																																							})
																																																						})
																																																					})
																																																				})
																																																			})
																																																		})
																																																	})
																																																})
																																															});
																																														})
																																													})
																																												})
																																											});
																																										}
																																									})
																																								})
																																							})
																																						})
																																					})
																																				}
																																			})
																																		}
																																		else {
																																			setTimeout(beginNode2, 1000);
																																			console.log('Attempting to reconnect to node');
																																		}
																																	}
																																	beginNode2();
																																}
																																// node 2 available
																																else
																																{
																																	// replication for node 2
																																	centralConnection2.beginTransaction(function(err){
																																		if(err){
																																			throw err;
																																		}
																																		
																																		centralConnection2.query(sqlLogReadAll, function(err, result){
																																			if(err){
																																				centralConnection2.rollback(function () {
																																					throw err;
																																				});
																																			}

																																			const centralLogs = result;
																																			// console.log('central node_id 1 next trans record = ' + centralLogs[0].next_trans_record);
																																			// console.log('central node_id 2 next trans record = ' + centralLogs[1].next_trans_record);
																																			// console.log('central node_id 3 next trans record = ' + centralLogs[2].next_trans_record);

																																			centralConnection2.commit(function(err){
																																				if (err) {
																																					centralConnection2.rollback(function () {
																																						throw err;
																																					});
																																				}

																																				node3Pool.getConnection(function(err, node3Connection){
																																					if(err){
																																						throw err;
																																					}

																																					node3Connection.ping(function(err){
																																						// node 3 failed
																																						if(err){
																																							console.log("Node 3 failed!");
																																						}
																																						// node 3 available
																																						else
																																						{
																																							console.log("Node 3 available!");

																																							node3Connection.query(setIsolationLevel, function (err) {
																																								if (err) {
																																									throw err;
																																								}

																																								node3Connection.beginTransaction(function(err){
																																									if (err) {
																																										throw err;
																																									}

																																									// query to get log files from node 3
																																									node3Connection.query(sqlLogReadAll, function(err, result){
																																										if (err) {
																																											node3Connection.rollback(function () {
																																												throw err;
																																											});
																																										}

																																										const node3Logs = result;
																																										// console.log('node 3 node_id 1 next trans record = ' + node3Logs[0].next_trans_record);
																																										// console.log('node 3 node_id 2 next trans record = ' + node3Logs[1].next_trans_record);
																																										// console.log('node 3 node_id 3 next trans record = ' + node3Logs[2].next_trans_record);

																																										node3Connection.commit(function(err){
																																											if(err){
																																												node3Connection.rollback(function () {
																																													throw err;
																																												});
																																											}

																																											let finalNodeLogs = centralLogs;
																																											if (centralLogs[0].next_trans_record < node3Logs[0].next_trans_record) {
																																												finalNodeLogs[0] = node3Logs[0];
																																											}
																																											if (centralLogs[1].next_trans_record < node3Logs[1].next_trans_record) {
																																												finalNodeLogs[1] = node3Logs[1];
																																											}
																																											if (centralLogs[2].next_trans_record < node3Logs[2].next_trans_record) {
																																												finalNodeLogs[2] = node3Logs[2];
																																											}

																																											// console.log('final next trans record = ' + finalNodeLogs[0].next_trans_record);
																																											// console.log('final next trans record = ' + finalNodeLogs[1].next_trans_record);
																																											// console.log('final next trans record = ' + finalNodeLogs[2].next_trans_record);

																																											// begin transaction to update log file in node 2
																																											node2Connection.beginTransaction(function(err){
																																												if (err) {
																																													throw err;
																																												}

																																												// update node 2 central log file to match central node
																																												console.log('Executing query for node 2 update of central log file');
																																												node2Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																													if (err) {
																																														node2Connection.rollback(function () {
																																															throw err;
																																														});
																																													}

																																													// commit node 2 log file of node id 1
																																													console.log('Committing node 2 update for central log file');
																																													node2Connection.commit(function(err){
																																														if (err) {
																																															node2Connection.rollback(function () {
																																																throw err;
																																															});
																																														}

																																														console.log('Commit success');

																																														node2Connection.beginTransaction(function(err){
																																															if (err) {
																																																throw err;
																																															}

																																															// commit node 2 log file update of node id 2
																																															console.log('Committing node 2 update for node 2 log file');
																																															node2Connection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result){
																																																if (err) {
																																																	node2Connection.rollback(function () {
																																																		throw err;
																																																	});
																																																}

																																																node2Connection.commit(function(err){
																																																	if (err) {
																																																		node2Connection.rollback(function () {
																																																			throw err;
																																																		});
																																																	}

																																																	console.log('Commit success');

																																																	// get statement from node 2 log
																																																	finalNodeLogs[1].next_trans_commit = finalNodeLogs[1].next_trans_commit + 1;
																																																	// get id for deletion from node 2 log
																																																	let statementStr = finalNodeLogs[1].statements.split('||| ');
																																																	// console.log('Statement #' + finalNodeLogs[1].next_trans_commit + ':' + statementStr[finalNodeLogs[1].next_trans_commit]);
																																																	statementStr = statementStr[finalNodeLogs[1].next_trans_commit].substr(statementStr[finalNodeLogs[1].next_trans_commit].indexOf(' ') + 1);
																																																	// console.log('no number:' + statementStr);

																																																	// delete id from central node
																																																	node2Connection.beginTransaction(function(err){
																																																		if (err) {
																																																			throw err;
																																																		}

																																																		console.log('Executing query to delete id from node 2');
																																																		node2Connection.query(statementStr, function(err, result){
																																																			if (err) {
																																																				node2Connection.rollback(function () {
																																																					throw err;
																																																				});
																																																			}

																																																			node2Connection.commit(function(err){
																																																				if (err) {
																																																					node2Connection.rollback(function () {
																																																						throw err;
																																																					});
																																																				}

																																																				console.log("Successfully deleted from node 2!");

																																																				// begin transaction to increment next_trans_commit for node 2 log file in node 2
																																																				node2Connection.beginTransaction(function(err){
																																																					if(err){
																																																						throw err;
																																																					}

																																																					console.log('Executing query to update next transaction commit count of node id 2 in node 2 log file');
																																																					node2Connection.query(sqlLogNextCommit, [finalNodeLogs[1].next_trans_commit, 2], function (err, result){
																																																						if (err) {
																																																							node2Connection.rollback(function () {
																																																								throw err;
																																																							});
																																																						}

																																																						node2Connection.commit(function(){
																																																							if(err){
																																																								node2Connection.rollback(function () {
																																																									throw err;
																																																								});
																																																							}
																																																							console.log('Log file update commit in node 2 successful!');
																																																							
																																																							// begin transaction to increment next_trans_commit for node 2 log file in central node
																																																							centralConnection2.beginTransaction(function(err){
																																																								if (err) {
																																																									throw err;
																																																								}

																																																								console.log('Executing query to update next transaction commit count of central node in central log file');
																																																								centralConnection2.query(sqlLogNextCommit, [finalNodeLogs[1].next_trans_commit, 2], function (err, result){
																																																									if (err) {
																																																										centralConnection2.rollback(function () {
																																																											throw err;
																																																										});
																																																									}

																																																									centralConnection2.commit(function(err){
																																																										if (err) {
																																																											centralConnection2.rollback(function () {
																																																												throw err;
																																																											});
																																																										}

																																																										console.log('Log file update in central node successful!');

																																																										// begin transaction to copy central node log file to node 3
																																																										node3Connection.beginTransaction(function(err){
																																																											if(err){
																																																												throw err;
																																																											}

																																																											console.log('Executing query for node 3 update of central log file');
																																																											node3Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																																												if (err) {
																																																													node3Connection.rollback(function () {
																																																														throw err;
																																																													});
																																																												}

																																																												node3Connection.commit(function(err){
																																																													if (err) {
																																																														node3Connection.rollback(function () {
																																																															throw err;
																																																														});
																																																													}

																																																													console.log("Log file update in node 3 successful!");

																																																													// begin transaction to copy node 2 log file to node 3
																																																													node3Connection.beginTransaction(function(err){
																																																														if(err){
																																																															throw err;
																																																														}

																																																														console.log('Executing query for node 3 update of node 2 log file');
																																																														node3Connection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result){
																																																															if (err) {
																																																																node3Connection.rollback(function () {
																																																																	throw err;
																																																																});
																																																															}

																																																															node3Connection.commit(function(err){
																																																																if (err) {
																																																																	node3Connection.rollback(function () {
																																																																		throw err;
																																																																	});
																																																																}

																																																																// begin transaction to unlock node 3
																																																																centralConnection2.beginTransaction(function() {
																																																																	if (err) {
																																																																		throw err;
																																																																	}

																																																																	console.log('Executing query to unlock central node');
																																																																	centralConnection2.query(sqlUnlockAll, function (err, result) {
																																																																		if (err) {
																																																																			centralConnection2.rollback(function() {
																																																																				throw err;
																																																																			});
																																																																		}

																																																																		centralConnection2.commit(function (err) {
																																																																			if (err) {
																																																																				centralConnection2.rollback(function() {
																																																																					throw err;
																																																																				});
																																																																			}

																																																																			console.log('Unlock committed');
																																																																			res.send('Successfully deleted movie entry');
																																																																		});
																																																																	});
																																																																});
																																																															})
																																																														})
																																																													})
																																																												})
																																																											})
																																																										})
																																																									})
																																																								})
																																																							})
																																																						})
																																																					})
																																																				})
																																																			})
																																																		})
																																																	})
																																																})
																																															})
																																														})
																																													})
																																												})
																																											})
																																										})
																																									})
																																								})
																																							});
																																						}
																																					})
																																				})
																																			})
																																		})
																																	})
																																}
																															})
																														})
																													})
																												})
																											})
																										})
																									})
																								})
																							})
																						})
																					})
																				}

																				// if year >= 1980 delete in node 3
																				else{
																					centralConnection2.beginTransaction(function(err){
																						if(err){
																							throw err;
																						}

																						let newStatement = `||| ${resultHolder[2].next_trans_record} ${sqlEntry}`;
																						let deleteSQL = `${sqlEntry}`;

																						// add id to statement string
																						deleteSQL = newStatement.substr(newStatement.indexOf('D'));
																						// console.log('deletesql:' + deleteSQL);

																						// update log file values
																						resultHolder[2].lock_status = 1;
																						resultHolder[2].next_trans_record = resultHolder[2].next_trans_record + 1;
																						// console.log('newstatement: ' + newStatement);

																						// console.log('before concat: ' + resultHolder[2].statements);

																						if (resultHolder[2].statements == null) resultHolder[2].statements = newStatement;
																						else resultHolder[2].statements = resultHolder[2].statements + newStatement;

																						// console.log('=======================================');
																						// console.log('STATEMENT STR: ' + resultHolder[2].statements);
																						// console.log('=======================================');

																						// display log file contents w/ updated fields
																						// console.log(resultHolder[2]);

																						centralConnection2.query(sqlLog, [resultHolder[2].lock_status, resultHolder[2].next_trans_record, resultHolder[2].statements, 3], function (err, result){
																							if(err){
																								centralConnection2.rollback(function () {
																									throw err;
																								});
																							}

																							centralConnection2.commit(function(err){
																								if(err){
																									centralConnection2.rollback(function () {
																										throw err;
																									});
																								}


																								// delete entry from central node
																								centralConnection2.beginTransaction(function(err){
																									if(err){
																										throw err;
																									}

																									console.log("Executing query to delete entry from central node");
																									centralConnection2.query(deleteSQL, function(err, result){
																										if(err){
																											centralConnection2.rollback(function(){
																												throw err;
																											})
																										}

																										centralConnection2.commit(function(err){
																											if(err){
																												centralConnection2.rollback(function(){
																													throw err;
																												})
																											}

																											console.log("Successfully deleted entry!");

																											// update central log file in central node
																											centralConnection2.beginTransaction(function(err){
																												if(err){
																													throw err;
																												}

																												resultHolder[0].next_trans_commit = resultHolder[0].next_trans_commit + 1;

																												console.log("Executing query to update next transaction commit count of central log file in central node");
																												centralConnection2.query(sqlLogNextCommit, [resultHolder[0].next_trans_commit, 1], function(err, result){
																													if(err){
																														centralConnection2.rollback(function(){
																															throw err;
																														})
																													}


																													// update log file in node 2 using central node log files
																													centralConnection2.commit(function(err){
																														if(err){
																															centralConnection2.rollback(function(){
																																throw err;
																															})
																														}

																														// connect to node 3
																														node3Pool.getConnection(function(err, node3Connection){
																															if(err){
																																throw err;
																															}

																															// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy node 3
																															// node3Connection.destroy();

																															console.log('Connecting to node 3');
																															node3Connection.ping(function(err){
																																// node 3 failed
																																if(err){
																																	console.log('Node 3 failed!');
																																	let newNode3Connection;

																																	// set delay before reconnecting to node 3
																																	setTimeout(function () {
																																		node3Pool.getConnection(function (err, connection) {
																																			if (err) {
																																				throw err;
																																			}
																																			newNode3Connection = connection;
																																			console.log('New connection established');
																																		});
																																	}, 5000); // change to 10000

																																	// periodic ping to check if connection is available
																																	function beginNode3(){
																																		if (newNode3Connection != undefined){
																																			newNode3Connection.ping(function(err){
																																				const timeoutId = setTimeout(beginNode3, 1000);
																																				if (err) {
																																					console.log('error');
																																				} 
																																				else
																																				{
																																					console.log('connected');
																																					clearTimeout(timeoutId);

																																					// start replication for node 3
																																					centralConnection2.beginTransaction(function(err){
																																						if(err){
																																							throw err;
																																						}
																																						
																																						centralConnection2.query(sqlLogReadAll, function(err, result){
																																							if(err){
																																								centralConnection2.rollback(function () {
																																									throw err;
																																								});
																																							}

																																							const centralLogs = result;
																																							// console.log('central node_id 1 next trans record = ' + centralLogs[0].next_trans_record);
																																							// console.log('central node_id 2 next trans record = ' + centralLogs[1].next_trans_record);
																																							// console.log('central node_id 3 next trans record = ' + centralLogs[2].next_trans_record);

																																							centralConnection2.commit(function(err){
																																								if (err) {
																																									centralConnection2.rollback(function () {
																																										throw err;
																																									});
																																								}

																																								node2Pool.getConnection(function(err, node2Connection){
																																									if(err){
																																										throw err;
																																									}

																																									node2Connection.ping(function(err){
																																										// node 2 failed
																																										if(err){
																																											console.log("Node 2 failed!");
																																										}
																																										// node 2 available
																																										else
																																										{
																																											console.log("Node 2 available!");

																																											node2Connection.beginTransaction(function(err){
																																												if (err) {
																																													throw err;
																																												}

																																												// query to get log files from node 2
																																												node2Connection.query(sqlLogReadAll, function(err, result){
																																													if (err) {
																																														node2Connection.rollback(function () {
																																															throw err;
																																														});
																																													}

																																													const node2Logs = result;
																																													// console.log('node 2 node_id 1 next trans record = ' + node2Logs[0].next_trans_record);
																																													// console.log('node 2 node_id 2 next trans record = ' + node2Logs[1].next_trans_record);
																																													// console.log('node 2 node_id 3 next trans record = ' + node2Logs[2].next_trans_record);

																																													node2Connection.commit(function(err){
																																														if(err){
																																															node2Connection.rollback(function () {
																																																throw err;
																																															});
																																														}

																																														let finalNodeLogs = centralLogs;
																																														if (centralLogs[0].next_trans_record < node2Logs[0].next_trans_record) {
																																															finalNodeLogs[0] = node2Logs[0];
																																														}
																																														if (centralLogs[1].next_trans_record < node2Logs[1].next_trans_record) {
																																															finalNodeLogs[1] = node2Logs[1];
																																														}
																																														if (centralLogs[2].next_trans_record < node2Logs[2].next_trans_record) {
																																															finalNodeLogs[2] = node2Logs[2];
																																														}

																																														// console.log('final next trans record = ' + finalNodeLogs[0].next_trans_record);
																																														// console.log('final next trans record = ' + finalNodeLogs[1].next_trans_record);
																																														// console.log('final next trans record = ' + finalNodeLogs[2].next_trans_record);

																																														newNode3Connection.query(setIsolationLevel, function (err) {
																																															if (err) {
																																																throw err;
																																															}

																																															// begin transaction to update log file in node 3
																																															newNode3Connection.beginTransaction(function(err){
																																																if (err) {
																																																	throw err;
																																																}

																																																// update node 2 central log file to match central node
																																																console.log('Executing query for node 3 update of central log file');
																																																newNode3Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																																	if (err) {
																																																		newNode3Connection.rollback(function () {
																																																			throw err;
																																																		});
																																																	}

																																																	// commit node 2 log file of node id 1
																																																	console.log('Committing node 2 update for central log file');
																																																	newNode3Connection.commit(function(err){
																																																		if (err) {
																																																			newNode3Connection.rollback(function () {
																																																				throw err;
																																																			});
																																																		}

																																																		console.log('Commit success');

																																																		newNode3Connection.beginTransaction(function(err){
																																																			if (err) {
																																																				throw err;
																																																			}

																																																			// commit node 3 log file update of node id 3
																																																			console.log('Committing node 3 update for node 3 log file');
																																																			newNode3Connection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result){
																																																				if (err) {
																																																					newNode3Connection.rollback(function () {
																																																						throw err;
																																																					});
																																																				}

																																																				newNode3Connection.commit(function(err){
																																																					if (err) {
																																																						newNode3Connection.rollback(function () {
																																																							throw err;
																																																						});
																																																					}

																																																					console.log('Commit success');

																																																					// get statement from node 2 log
																																																					finalNodeLogs[2].next_trans_commit = finalNodeLogs[2].next_trans_commit + 1;
																																																					// get id for deletion from node 2 log
																																																					let statementStr = finalNodeLogs[2].statements.split('||| ');
																																																					// console.log('Statement #' + finalNodeLogs[2].next_trans_commit + ':' + statementStr[finalNodeLogs[2].next_trans_commit]);
																																																					statementStr = statementStr[finalNodeLogs[2].next_trans_commit].substr(statementStr[finalNodeLogs[2].next_trans_commit].indexOf(' ') + 1);
																																																					// console.log('no number:' + statementStr);

																																																					// delete id from node 3
																																																					newNode3Connection.beginTransaction(function(err){
																																																						if (err) {
																																																							throw err;
																																																						}

																																																						console.log('Executing query to delete id from node 3');
																																																						newNode3Connection.query(statementStr, function(err, result){
																																																							if (err) {
																																																								newNode3Connection.rollback(function () {
																																																									throw err;
																																																								});
																																																							}

																																																							newNode3Connection.commit(function(err){
																																																								if (err) {
																																																									newNode3Connection.rollback(function () {
																																																										throw err;
																																																									});
																																																								}

																																																								console.log("Successfully deleted from node 3!");

																																																								// begin transaction to increment next_trans_commit for node 3 log file in node 3
																																																								newNode3Connection.beginTransaction(function(err){
																																																									if(err){
																																																										throw err;
																																																									}

																																																									console.log('Executing query to update next transaction commit count of node id 3 in node 3 log file');
																																																									newNode3Connection.query(sqlLogNextCommit, [finalNodeLogs[2].next_trans_commit, 3], function (err, result){
																																																										if (err) {
																																																											newNode3Connection.rollback(function () {
																																																												throw err;
																																																											});
																																																										}

																																																										newNode3Connection.commit(function(){
																																																											if(err){
																																																												newNode3Connection.rollback(function () {
																																																													throw err;
																																																												});
																																																											}
																																																											console.log('Log file update commit in node 3 successful!');
																																																											
																																																											// begin transaction to increment next_trans_commit for node 3 log file in central node
																																																											centralConnection2.beginTransaction(function(err){
																																																												if (err) {
																																																													throw err;
																																																												}

																																																												console.log('Executing query to update next transaction commit count of central node in central log file');
																																																												centralConnection2.query(sqlLogNextCommit, [finalNodeLogs[2].next_trans_commit, 3], function (err, result){
																																																													if (err) {
																																																														centralConnection2.rollback(function () {
																																																															throw err;
																																																														});
																																																													}

																																																													centralConnection2.commit(function(err){
																																																														if (err) {
																																																															centralConnection2.rollback(function () {
																																																																throw err;
																																																															});
																																																														}

																																																														console.log('Log file update in central node successful!');

																																																														// begin transaction to copy central node log file to node 3
																																																														node2Connection.beginTransaction(function(err){
																																																															if(err){
																																																																throw err;
																																																															}

																																																															console.log('Executing query for node 3 update of central log file');
																																																															node2Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																																																if (err) {
																																																																	node2Connection.rollback(function () {
																																																																		throw err;
																																																																	});
																																																																}

																																																																node2Connection.commit(function(err){
																																																																	if (err) {
																																																																		node2Connection.rollback(function () {
																																																																			throw err;
																																																																		});
																																																																	}

																																																																	console.log("Log file update in node 3 successful!");

																																																																	// begin transaction to copy node 2 log file to node 3
																																																																	node2Connection.beginTransaction(function(err){
																																																																		if(err){
																																																																			throw err;
																																																																		}

																																																																		console.log('Executing query for node 3 update of node 2 log file');
																																																																		node2Connection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result){
																																																																			if (err) {
																																																																				node2Connection.rollback(function () {
																																																																					throw err;
																																																																				});
																																																																			}

																																																																			node2Connection.commit(function(err){
																																																																				if (err) {
																																																																					node2Connection.rollback(function () {
																																																																						throw err;
																																																																					});
																																																																				}

																																																																				// begin transaction to unlock node 3
																																																																				centralConnection2.beginTransaction(function() {
																																																																					if (err) {
																																																																						throw err;
																																																																					}

																																																																					console.log('Executing query to unlock central node');
																																																																					centralConnection2.query(sqlUnlockAll, function (err, result) {
																																																																						if (err) {
																																																																							centralConnection2.rollback(function() {
																																																																								throw err;
																																																																							});
																																																																						}

																																																																						centralConnection2.commit(function (err) {
																																																																							if (err) {
																																																																								centralConnection2.rollback(function() {
																																																																									throw err;
																																																																								});
																																																																							}

																																																																							console.log('Unlock committed');
																																																																							res.send('Successfully deleted movie entry');
																																																																						});
																																																																					});
																																																																				});
																																																																			})
																																																																		})
																																																																	})
																																																																})
																																																															})
																																																														})
																																																													})
																																																												})
																																																											})
																																																										})
																																																									})
																																																								})
																																																							})
																																																						})
																																																					})
																																																				})
																																																			})
																																																		})
																																																	})
																																																})
																																															})
																																														});
																																													})
																																												})
																																											})
																																										}
																																									})
																																								})
																																							})
																																						})
																																					})
																																				}
																																			})
																																		}
																																		else {
																																			setTimeout(beginNode3, 1000);
																																			console.log('Attempting to reconnect to node');
																																		}
																																	}
																																	beginNode3();
																																}
																																// node 3 available
																																else
																																{
																																	// replication for node 3
																																	centralConnection2.beginTransaction(function(err){
																																		if(err){
																																			throw err;
																																		}
																																		
																																		centralConnection2.query(sqlLogReadAll, function(err, result){
																																			if(err){
																																				centralConnection2.rollback(function () {
																																					throw err;
																																				});
																																			}

																																			const centralLogs = result;
																																			// console.log('central node_id 1 next trans record = ' + centralLogs[0].next_trans_record);
																																			// console.log('central node_id 2 next trans record = ' + centralLogs[1].next_trans_record);
																																			// console.log('central node_id 3 next trans record = ' + centralLogs[2].next_trans_record);

																																			centralConnection2.commit(function(err){
																																				if (err) {
																																					centralConnection2.rollback(function () {
																																						throw err;
																																					});
																																				}

																																				node2Pool.getConnection(function(err, node2Connection){
																																					if(err){
																																						throw err;
																																					}

																																					node2Connection.ping(function(err){
																																						// node 2 failed
																																						if(err){
																																							console.log("Node 2 failed!");
																																						}
																																						// node 2 available
																																						else
																																						{
																																							console.log("Node 2 available!");

																																							node2Connection.query(setIsolationLevel, function (err) {
																																								if (err) {
																																									throw err;
																																								}

																																								node2Connection.beginTransaction(function(err){
																																									if (err) {
																																										throw err;
																																									}

																																									// query to get log files from node 2
																																									node2Connection.query(sqlLogReadAll, function(err, result){
																																										if (err) {
																																											node2Connection.rollback(function () {
																																												throw err;
																																											});
																																										}

																																										const node2Logs = result;
																																										// console.log('node 2 node_id 1 next trans record = ' + node2Logs[0].next_trans_record);
																																										// console.log('node 2 node_id 2 next trans record = ' + node2Logs[1].next_trans_record);
																																										// console.log('node 2 node_id 3 next trans record = ' + node2Logs[2].next_trans_record);

																																										node2Connection.commit(function(err){
																																											if(err){
																																												node2Connection.rollback(function () {
																																													throw err;
																																												});
																																											}

																																											let finalNodeLogs = centralLogs;
																																											if (centralLogs[0].next_trans_record < node2Logs[0].next_trans_record) {
																																												finalNodeLogs[0] = node2Logs[0];
																																											}
																																											if (centralLogs[1].next_trans_record < node2Logs[1].next_trans_record) {
																																												finalNodeLogs[1] = node2Logs[1];
																																											}
																																											if (centralLogs[2].next_trans_record < node2Logs[2].next_trans_record) {
																																												finalNodeLogs[2] = node2Logs[2];
																																											}

																																											// console.log('final next trans record = ' + finalNodeLogs[0].next_trans_record);
																																											// console.log('final next trans record = ' + finalNodeLogs[1].next_trans_record);
																																											// console.log('final next trans record = ' + finalNodeLogs[2].next_trans_record);

																																											// begin transaction to update log file in node 3
																																											node3Connection.beginTransaction(function(err){
																																												if (err) {
																																													throw err;
																																												}

																																												// update node 3 central log file to match central node
																																												console.log('Executing query for node 3 update of central log file');
																																												node3Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																													if (err) {
																																														node3Connection.rollback(function () {
																																															throw err;
																																														});
																																													}

																																													
																																													console.log('Committing node 2 update for central log file');
																																													node3Connection.commit(function(err){
																																														if (err) {
																																															node3Connection.rollback(function () {
																																																throw err;
																																															});
																																														}

																																														console.log('Commit success');

																																														node3Connection.beginTransaction(function(err){
																																															if (err) {
																																																throw err;
																																															}

																																															// commit node 3 log file update of node id 3
																																															console.log('Committing node 2 update for node 2 log file');
																																															node3Connection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result){
																																																if (err) {
																																																	node3Connection.rollback(function () {
																																																		throw err;
																																																	});
																																																}

																																																node3Connection.commit(function(err){
																																																	if (err) {
																																																		node3Connection.rollback(function () {
																																																			throw err;
																																																		});
																																																	}

																																																	console.log('Commit success');

																																																	// get statement from node 2 log
																																																	finalNodeLogs[2].next_trans_commit = finalNodeLogs[2].next_trans_commit + 1;
																																																	// get id for deletion from node 2 log
																																																	let statementStr = finalNodeLogs[2].statements.split('||| ');
																																																	// console.log('Statement #' + finalNodeLogs[2].next_trans_commit + ':' + statementStr[finalNodeLogs[2].next_trans_commit]);
																																																	statementStr = statementStr[finalNodeLogs[2].next_trans_commit].substr(statementStr[finalNodeLogs[2].next_trans_commit].indexOf(' ') + 1);
																																																	// console.log('no number:' + statementStr);

																																																	// delete id from central node
																																																	node3Connection.beginTransaction(function(err){
																																																		if (err) {
																																																			throw err;
																																																		}

																																																		console.log('Executing query to delete id from node 3');
																																																		node3Connection.query(statementStr, function(err, result){
																																																			if (err) {
																																																				node3Connection.rollback(function () {
																																																					throw err;
																																																				});
																																																			}

																																																			node3Connection.commit(function(err){
																																																				if (err) {
																																																					node3Connection.rollback(function () {
																																																						throw err;
																																																					});
																																																				}

																																																				console.log("Successfully deleted from node 3!");

																																																				// begin transaction to increment next_trans_commit for node 3 log file in node 3
																																																				node3Connection.beginTransaction(function(err){
																																																					if(err){
																																																						throw err;
																																																					}

																																																					console.log('Executing query to update next transaction commit count of node id 3 in node 3 log file');
																																																					node3Connection.query(sqlLogNextCommit, [finalNodeLogs[2].next_trans_commit, 3], function (err, result){
																																																						if (err) {
																																																							node3Connection.rollback(function () {
																																																								throw err;
																																																							});
																																																						}

																																																						node3Connection.commit(function(){
																																																							if(err){
																																																								node3Connection.rollback(function () {
																																																									throw err;
																																																								});
																																																							}
																																																							console.log('Log file update commit in node 3 successful!');
																																																							
																																																							// begin transaction to increment next_trans_commit for node 2 log file in central node
																																																							centralConnection2.beginTransaction(function(err){
																																																								if (err) {
																																																									throw err;
																																																								}

																																																								console.log('Executing query to update next transaction commit count of central node in central log file');
																																																								centralConnection2.query(sqlLogNextCommit, [finalNodeLogs[2].next_trans_commit, 3], function (err, result){
																																																									if (err) {
																																																										centralConnection2.rollback(function () {
																																																											throw err;
																																																										});
																																																									}

																																																									centralConnection2.commit(function(err){
																																																										if (err) {
																																																											centralConnection2.rollback(function () {
																																																												throw err;
																																																											});
																																																										}

																																																										console.log('Log file update in central node successful!');

																																																										// begin transaction to copy central node log file to node 2
																																																										node2Connection.beginTransaction(function(err){
																																																											if(err){
																																																												throw err;
																																																											}

																																																											console.log('Executing query for node 2 update of central log file');
																																																											node2Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result){
																																																												if (err) {
																																																													node2Connection.rollback(function () {
																																																														throw err;
																																																													});
																																																												}

																																																												node2Connection.commit(function(err){
																																																													if (err) {
																																																														node2Connection.rollback(function () {
																																																															throw err;
																																																														});
																																																													}

																																																													console.log("Log file update in node 2 successful!");

																																																													// begin transaction to copy node 3 log file to node 2
																																																													node2Connection.beginTransaction(function(err){
																																																														if(err){
																																																															throw err;
																																																														}

																																																														console.log('Executing query for node 3 update of node 2 log file');
																																																														node2Connection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result){
																																																															if (err) {
																																																																node2Connection.rollback(function () {
																																																																	throw err;
																																																																});
																																																															}

																																																															node2Connection.commit(function(err){
																																																																if (err) {
																																																																	node2Connection.rollback(function () {
																																																																		throw err;
																																																																	});
																																																																}

																																																																// begin transaction to unlock central node
																																																																centralConnection2.beginTransaction(function() {
																																																																	if (err) {
																																																																		throw err;
																																																																	}

																																																																	console.log('Executing query to unlock central node');
																																																																	centralConnection2.query(sqlUnlockAll, function (err, result) {
																																																																		if (err) {
																																																																			centralConnection2.rollback(function() {
																																																																				throw err;
																																																																			});
																																																																		}

																																																																		centralConnection2.commit(function (err) {
																																																																			if (err) {
																																																																				centralConnection2.rollback(function() {
																																																																					throw err;
																																																																				});
																																																																			}

																																																																			console.log('Unlock committed');
																																																																			res.send('Successfully deleted movie entry');
																																																																		});
																																																																	});
																																																																});
																																																															})
																																																														})
																																																													})
																																																												})
																																																											})
																																																										})
																																																									})
																																																								})
																																																							})
																																																						})
																																																					})
																																																				})
																																																			})
																																																		})
																																																	})
																																																})
																																															})
																																														})
																																													})
																																												})
																																											})
																																										})
																																									})
																																								})
																																							});
																																						}
																																					})
																																				})
																																			})
																																		})
																																	})
																																}
																															})
																														})
																													})
																												})
																											})
																										})
																									})
																								})
																							})
																						})
																					})
																				}
																			})
																		})
																	})
																})
															})
														})
													}
												});
											}
											beginDelete();
										});
									});
									
								});
							}
						})
					})
				}
			});
		});
	}
};

module.exports = deleteController;
