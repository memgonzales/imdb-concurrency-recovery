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

let timer = 0;
let node2Timer = 0;

const updateController = {
	updateEntry: function (req, res) {

        const id = req.body.id;
		const title = req.body.title;
		const genre = req.body.genre;
		const rank = req.body.rank;
		const director = req.body.director;
		const actor1 = req.body.actor1;
		const actor2 = req.body.actor2;

        const isolationLevel = req.body.isolationLevel;
        const setIsolationLevel = isolationLevelSql + isolationLevel;
        
		const sqlEntry = `UPDATE movies SET name ='${title}',genre='${genre}',\`rank\`=${rank},director='${director}',actor1='${actor1}',actor2='${actor2}' WHERE id=${id}`;
		const sqlEntryFill = 'UPDATE movies SET name = ?, genre = ?, `rank` = ?, director = ?, actor1 = ?, actor2 = ? WHERE id = ?';
		const sqlLog = 'UPDATE log SET lock_status=?, next_trans_record=?, statements=? WHERE node_id=?';
		const sqlLogId = 'UPDATE log SET lock_status=?, next_trans_record=?, id_new_entry=?, statements=? WHERE node_id=?';
		const sqlLogCommitId = 'UPDATE log SET lock_status=?, next_trans_record=?, next_trans_commit=?, id_new_entry=?, statements=? WHERE node_id=?';
		const sqlLogFull = 'UPDATE log SET lock_status=?, next_trans_record=?, next_trans_commit=?, id_new_entry=?, statements=? WHERE node_id=?';
		const sqlLogNextCommit = 'UPDATE log SET next_trans_commit=? WHERE node_id=?';

		const sqlLogRead1 = 'SELECT * FROM log WHERE node_id = 1';
		const sqlLogRead2 = 'SELECT * FROM log WHERE node_id = 2';
		const sqlLogRead3 = 'SELECT * FROM log WHERE node_id = 3';
		const sqlLogReadAll = 'SELECT * FROM log';

		const sqlUnlockAll = 'UPDATE log SET lock_status=0';

        centralPool.getConnection(function(err, centralCon){
            if(err) throw err;

            const yearSQL = `SELECT * FROM movies WHERE id = ` + id;

            centralCon.query(yearSQL, function(err, result){

                const year = result[0].year;
                

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
                            
                            // insert in node 2 first then replicate to central
                            if (year < 1980) {
                                node2Pool.getConnection(function (err, node2Connection) {
                                    if (err) {
                                        throw err;
                                    }
        
                                    // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy node 2
                                    // node2Connection.destroy();
        
                                    node2Connection.ping(function (err) {
                                        // node 2 failed
                                        if (err) {
                                            console.log('Node 2 failed!');
                                            // should be in node 2 but node 2 is down --> unavailable all servers
                                            res.send('Servers are unavailable at the moment. Please try again later.');
                                        }

                                        node2Connection.query(setIsolationLevel, function (err) {
                                            if (err) {
                                                throw err;
                                            }
        
                                            node2Connection.query(sqlLogRead1, function (err, result) {
                                                if (err) throw err;
                                                
            
                                                function beginInsert() {
                                                    node2Connection.query(sqlLogRead1, function (err, result) {
                                                        let lock = result[0].lock_status;
                                                        const timeoutId = setTimeout(beginInsert, 1000);
                                                        if (lock == 1) {
                                                            if (timer == 100) {
                                                                console.log('Timeout');
                                                                clearTimeout(timeoutId);
                                                                res.send('Our servers are busy at the moment. Please try again later.');
                                                            }
                                                            console.log('Node locked');
                                                            timer = timer + 1;
                                                        } 
                                                        else 
                                                        {
                                                            console.log('Node free');
                                                            clearTimeout(timeoutId);
            
                                                            // continue once unlocked
                                                           
            
                                                            let newStatement = `||| ${result[0].next_trans_record} ${sqlEntry}`;
                                                            let insertSQL = `${sqlEntry}`;
            
                                                            // result[0].id_new_entry = result[0].id_new_entry + 1;
            
                                                            // // add id to statement string
                                                            // newStatement = insertSQL.slice(0, 85) + result[0].id_new_entry + ',' + insertSQL.slice(85);
                                                            // console.log('w/ id value: ' + newStatement);
                                                            // insertSQL = newStatement.substr(newStatement.indexOf('I'));
                                                            // console.log('tempstate:' + insertSQL);
            
                                                            // newStatement = `||| ${result[0].next_trans_record} ${newStatement}`;
            
                                                            // update log file values
                                                            result[0].lock_status = 1;
                                                            result[0].next_trans_record = result[0].next_trans_record + 1;
            
                                                            
            
                                                            if (result[0].statements == null) result[0].statements = newStatement;
                                                            else result[0].statements = result[0].statements + newStatement;
            
                                                           
            
                                                            const resultHolder = result[0];
            
                                                            
            
                                                            node2Connection.beginTransaction(function (err) {
                                                                if (err) {
                                                                    throw err;
                                                                }
            
                                                                console.log('Executing update log file query in node 2');
                                                                // update log file
                                                                node2Connection.query(sqlLog, [result[0].lock_status, result[0].next_trans_record, result[0].statements, 1], function (err, result) {
                                                                    if (err) {
                                                                        node2Connection.rollback(function () {
                                                                            throw err;
                                                                        });
                                                                    }
            
                                                                    console.log('Executing update log file commit in node 2');
                                                                    node2Connection.commit(function (err) {
                                                                        if (err) {
                                                                            node2Connection.rollback(function () {
                                                                                throw err;
                                                                            });
                                                                        }
                                                                        console.log('Update Committed');
                                                                        // begin transaction for updating movies table
                                                                        node2Connection.beginTransaction(function (err) {
                                                                            if (err) {
                                                                                throw err;
                                                                            }
            
                                                                            console.log('Executing update movies table query in node 2');
                                                                            // query for updating movies table using web app input
                                                                            node2Connection.query(insertSQL, function (err, result) {
                                                                                
                                                                                if (err) {
                                                                                    node2Connection.rollback(function () {
                                                                                        throw err;
                                                                                    });
                                                                                }
            
                                                                                // commit movies table update
                                                                                console.log('Executing update movies table commit');
                                                                                node2Connection.commit(function (err) {
                                                                                    if (err) {
                                                                                        node2Connection.rollback(function () {
                                                                                            throw err;
                                                                                        });
                                                                                    }
                                                                                    console.log('Entry Insertion Successful!');
            
                                                                                    // start transaction to update next_trans_commit and id_new_entry in log file
                                                                                    node2Connection.beginTransaction(function (err) {
                                                                                        if (err) {
                                                                                            throw err;
                                                                                        }
                                                                                        const sqlLog = 'UPDATE log SET next_trans_commit=?, id_new_entry=? WHERE node_id=?';
                                                                                        // resultHolder.next_trans_commit = resultHolder.next_trans_commit + 1;
            
                                                                                        
            
                                                                                        // execute query to update next_trans_commit and id_new_entry in node 2 - central log file
                                                                                        console.log('Executing query to update next_trans_commit and id_new_entry in node 2 - central log file');
                                                                                        node2Connection.query(sqlLog, [resultHolder.next_trans_commit, resultHolder.id_new_entry, 1], function (err, result) {
                                                                                            if (err) {
                                                                                                node2Connection.rollback(function () {
                                                                                                    throw err;
                                                                                                });
                                                                                            }
            
                                                                                            console.log('Query successful! Committing to database');
                                                                                            node2Connection.commit(function (err) {
                                                                                                if (err) {
                                                                                                    node2Connection.rollback(function () {
                                                                                                        throw err;
                                                                                                    });
                                                                                                }
            
                                                                                                console.log('Begin query to read log file');
                                                                                                node2Connection.query(sqlLogRead1, function (err, result) {
                                                                                                    if (err) {
                                                                                                        node2Connection.rollback(function () {
                                                                                                            throw err;
                                                                                                        });
                                                                                                    }
            
                                                                                                    let statementStr = result[0].statements.split('||| ');
                                                                                                   
                                                                                                    statementStr = statementStr[resultHolder.next_trans_record].substr(statementStr[resultHolder.next_trans_record].indexOf(' ') + 1);
                                                                                                   
                                                                                                    console.log('Committing');
            
                                                                                                    node2Connection.commit(function (err) {
                                                                                                        if (err) {
                                                                                                            node2Connection.rollback(function () {
                                                                                                                throw err;
                                                                                                            });
                                                                                                        }
            
                                                                                                        const centralLog = resultHolder;
            
                                                                                                        console.log('Commit successful!');
                                                                                                        
            
                                                                                                        
            
                                                                                                     
            
                                                                                                        // begin transaction to read node 2 log file in node 2
                                                                                                        node2Connection.beginTransaction(function (err) {
                                                                                                            if (err) {
                                                                                                                throw err;
                                                                                                            }
            
                                                                                                            node2Connection.query(sqlLogRead2, function (err, result) {
                                                                                                                if (err) {
                                                                                                                    node2Connection.rollback(function () {
                                                                                                                        throw err;
                                                                                                                    });
                                                                                                                }
            
                                                                                                                let node2Log = result;
            
                                                                                                                node2Connection.commit(function (err) {
                                                                                                                    if (err) {
                                                                                                                        node2Connection.rollback(function () {
                                                                                                                            throw err;
                                                                                                                        });
                                                                                                                    }
                                                                                                                    
            
                                                                                                                    node2Connection.beginTransaction(function (err) {
                                                                                                                        if (err) {
                                                                                                                            throw err;
                                                                                                                        }
                                                                                                                       
            
                                                                                                                        let node2Statement;
                                                                                                                        if (node2Log[0].statements == null) node2Statement = '||| ' + node2Log[0].next_trans_record + ' ' + statementStr;
                                                                                                                        else node2Statement = node2Log[0].statements + '||| ' + node2Log[0].next_trans_record + ' ' + statementStr;
            
                                                                                                                        node2Log[0].next_trans_record = node2Log[0].next_trans_record + 1;
                                                                                                                        node2Log[0].next_trans_commit = node2Log[0].next_trans_commit + 1;
                                                                                                                        node2Log[0].id_new_entry = resultHolder.id_new_entry;
                                                                                                                        node2Log[0].statements = node2Statement;
            
                                                                                                                        
                                                                                                                        // 
            
                                                                                                                        // execute query to change transaction record and id new entry + append statement for node2Log
                                                                                                                        node2Connection.query(sqlLogCommitId, [1, node2Log[0].next_trans_record, node2Log[0].next_trans_commit, node2Log[0].id_new_entry, node2Log[0].statements, 2], function (err, result) {
                                                                                                                            if (err) {
                                                                                                                                node2Connection.rollback(function () {
                                                                                                                                    throw err;
                                                                                                                                });
                                                                                                                            }
                                                                                                                            console.log('Next transaction record, id new entry, and statements updated! Node 2');
            
                                                                                                                            node2Connection.commit(function (err) {
                                                                                                                                if (err) {
                                                                                                                                    node2Connection.rollback(function () {
                                                                                                                                        throw err;
                                                                                                                                    });
                                                                                                                                }
            
                                                                                                                                // central node replication start
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
                                                                                                                                                        
                                                                                                                                                        newCentralConnection.query(setIsolationLevel, function (err) {
                                                                                                                                                            if (err) {
                                                                                                                                                                throw err;
                                                                                                                                                            }

                                                                                                                                                            // recovery for central node crash
                                                                                                                                                            node2Connection.beginTransaction(function (err) {
                                                                                                                                                                if (err) {
                                                                                                                                                                    throw err;
                                                                                                                                                                }
                
                                                                                                                                                                console.log('Extracting log files from central node');
                                                                                                                                                                // query to get all log files from node 2
                                                                                                                                                                node2Connection.query(sqlLogReadAll, function (err, result) {
                                                                                                                                                                    if (err) {
                                                                                                                                                                        node2Connection.rollback(function () {
                                                                                                                                                                            throw err;
                                                                                                                                                                        });
                                                                                                                                                                    }
                
                                                                                                                                                                    const node2Logs = result;
                                                                
                
                                                                                                                                                                    node2Connection.commit(function (err) {
                                                                                                                                                                        if (err) {
                                                                                                                                                                            node2Connection.rollback(function () {
                                                                                                                                                                                throw err;
                                                                                                                                                                            });
                                                                                                                                                                        }
                
                                                                                                                                                                        // connect to node 3 to get log files and compare longest length with node 2 log file
                                                                                                                                                                        node3Pool.getConnection(function (err, node3Connection) {
                                                                                                                                                                            if (err) {
                                                                                                                                                                                throw err;
                                                                                                                                                                            }
                
                                                                                                                                                                            node3Connection.ping(function (err) {
                                                                                                                                                                                if (err) {
                                                                                                                                                                                    console.log('Node 3 failed!');
                                                                                                                                                                                }

                                                                                                                                                                                node3Connection.query(setIsolationLevel, function (err) {
                                                                                                                                                                                    if (err) {
                                                                                                                                                                                        throw err;
                                                                                                                                                                                    }
                
                                                                                                                                                                                    // query to get log files from node 3
                                                                                                                                                                                    node3Connection.query(sqlLogReadAll, function (err, result) {
                                                                                                                                                                                        if (err) {
                                                                                                                                                                                            node3Connection.rollback(function () {
                                                                                                                                                                                                throw err;
                                                                                                                                                                                            });
                                                                                                                                                                                        }
                    
                                                                                                                                                                                        const node3Logs = result;
                                                                                                                  
                    
                                                                                                                                                                                        node3Connection.commit(function (err) {
                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                node3Connection.rollback(function () {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                });
                                                                                                                                                                                            }
                                                                                                                                                                                            let finalNodeLogs = node2Logs;
                                                                                                                                                                                            if (node2Logs[0].next_trans_record < node3Logs[0].next_trans_record) {
                                                                                                                                                                                                finalNodeLogs[0] = node3Logs[0];
                                                                                                                                                                                            }
                                                                                                                                                                                            if (node2Logs[1].next_trans_record < node3Logs[1].next_trans_record) {
                                                                                                                                                                                                finalNodeLogs[1] = node3Logs[1];
                                                                                                                                                                                            }
                                                                                                                                                                                            if (node2Logs[2].next_trans_record < node3Logs[2].next_trans_record) {
                                                                                                                                                                                                finalNodeLogs[2] = node3Logs[2];
                                                                                                                                                                                            }
                    
                                                                                                                                                                                     
                    
                                                                                                                                                                                            newCentralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                }
                    
                                                                                                                                                                                                // update node 2 central log file to match central node
                                                                                                                                                                                                console.log('Executing query for central node update of central log file');
                                                                                                                                                                                                newCentralConnection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                        newCentralConnection.rollback(function () {
                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                        });
                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                    // commit central node log file of node id 1
                                                                                                                                                                                                    console.log('Committing changes: central node update for central log file');
                                                                                                                                                                                                    newCentralConnection.commit(function (err) {
                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                            newCentralConnection.rollback(function () {
                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                            });
                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                        console.log('Commit success');
                    
                                                                                                                                                                                                        newCentralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                            // commit central node log file update of node id 2
                                                                                                                                                                                                            console.log('Executing query for central node update of node 2 log file');
                                                                                                                                                                                                            newCentralConnection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result) {
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
                    
                                                                                                                                                                                                                    console.log('Commit success');
                                                                                                                                                                                                                    console.log('Beginning statement extraction from node 2');
                                                                                                                                                                                                                    statementStr = finalNodeLogs[1].statements.split('||| ');
                                                                                                                                                                                                                   
                                                                                                                                                                                                                    statementStr = statementStr[finalNodeLogs[1].next_trans_record].substr(statementStr[finalNodeLogs[1].next_trans_record].indexOf(' ') + 1);
                                                                                                                                                                                                                  
                    
                                                                                                                                                                                                                    console.log('Start updating entry');
                                                                                                                                                                                                                    // get statement inputs
                                                                                                                                                                                                                    // `UPDATE movies SET name ='${title}',genre='${genre}',\`rank\`=${rank},director='${director}',actor1='${actor1}',actor2='${actor2}' WHERE id=${id}`;
                                                                                                                                                                                                                    let entries = statementStr.slice(25);
                                                                                                                                                                                                                   
                                                                                                                                                                                                                    entries = entries.split(',');
                                                                                                                                                                                                                    entries[0] = entries[0].slice(0, -1);   // title
                                                                                                                                                                                                                    entries[1] = entries[1].slice(7, -1);   // genre
                                                                                                                                                                                                                    entries[2] = entries[2].slice(7);       // rank
                                                                                                                                                                                                                    entries[3] = entries[3].slice(10, -1);  // director
                                                                                                                                                                                                                    entries[4] = entries[4].slice(8, -1);   // actor 1
                                                                                                                                                                                                                    let buffer = entries[5].split(' WHERE id=');
                                                                                                                                                                                                                    entries[5] = buffer[0].slice(8, -1);    // actor 2
                                                                                                                                                                                                                    entries[6] = buffer[1];        // id
                                                                                                                                                                                                                 
                                                                                                                                                                        
                    
                                                                                                                                                                                                                    console.log('Executing query for central node update of movies table');
                                                                                                                                                                                                                    // update movies table in central node using statement
                                                                                                                                                                                                                    newCentralConnection.query(sqlEntryFill, [entries[0], entries[1], entries[2], entries[3], entries[4], entries[5], entries[6]], function (err, result) {
                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                            newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                            });
                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                        console.log('Update successful!');
                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                        newCentralConnection.commit(function (err) {
                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                });
                                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                                            console.log('Commit successful!');
                    
                                                                                                                                                                                                                            // update central node log file in central node
                                                                                                                                                                                                                            newCentralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                // increment next_trans_commit counter by 1
                                                                                                                                                                                                                                finalNodeLogs[0].next_trans_commit = finalNodeLogs[0].next_trans_commit + 1;
                    
                                                                                                                                                                                                                                // execute query to update next_trans_commit counter of node id 1 in central node log file
                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count of node id 1 in central node log file');
                                                                                                                                                                                                                                newCentralConnection.query(sqlLogNextCommit, [finalNodeLogs[0].next_trans_commit, 1], function (err, result) {
                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                        newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                    newCentralConnection.commit(function () {
                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                            newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                                        console.log('Commit successful!');
                    
                                                                                                                                                                                                                                        // update node id 1 log file in node 2
                                                                                                                                                                                                                                        node2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                                                            // execute query to update next_trans_commit counter of node id 1 in node 2 log file
                                                                                                                                                                                                                                            console.log('Executing query to update next transaction commit count of node id 1 in node 2 log file');
                                                                                                                                                                                                                                            node2Connection.query(sqlLogNextCommit, [finalNodeLogs[0].next_trans_commit, 1], function (err, result) {
                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                    node2Connection.rollback(function () {
                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                                console.log('Query Successful');
                                                                                                                                                                                                                                                console.log('Committing changes');
                                                                                                                                                                                                                                                node2Connection.commit(function (err) {
                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                        node2Connection.rollback(function () {
                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                                    console.log('Commit successful!');
                    
                                                                                                                                                                                                                                                    // update node id 1 log file in node 3
                                                                                                                                                                                                                                                    node3Connection.ping(function () {
                                                                                                                                                                                                                                                        // node 3 failed
                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                            console.log('Node 3 failed!');
                                                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                                                        // node 3 available
                                                                                                                                                                                                                                                        else {
                                                                                                                                                                                                                                                            // execute query to update central node log file record in node 3
                                                                                                                                                                                                                                                            console.log('Executing query to update next transaction commit count for central node log file in node 3');
                                                                                                                                                                                                                                                            node3Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                                    node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                                                console.log('Query Successful');
                                                                                                                                                                                                                                                                console.log('Committing changes');
                                                                                                                                                                                                                                                                node3Connection.commit(function (err) {
                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                                                    console.log('Commit successful!');
                    
                                                                                                                                                                                                                                                                    node3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                                                                        // execute query to update node 2 log file record in node 3
                                                                                                                                                                                                                                                                        console.log('Executing query to update next transaction commit count for node 2 log file in node 3');
                                                                                                                                                                                                                                                                        node3Connection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result) {
                                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                                node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                                                                                            console.log('Query Successful');
                                                                                                                                                                                                                                                                            console.log('Committing changes');
                                                                                                                                                                                                                                                                            node3Connection.commit(function (err) {
                                                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                                                    node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                                                                console.log('Commit successful!');
                                                                                                                                                                                                                                                                                // start transaction to unlock node 2
                                                                                                                                                                                                                                                                                node2Connection.beginTransaction(function () {
                                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                                                                    console.log('Executing query to unlock central node');
                                                                                                                                                                                                                                                                                    node2Connection.query(sqlUnlockAll, function (err, result) {
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
                    
                                                                                                                                                                                                                                                                                            console.log('Unlock committed');
                                                                                                                                                                                                                                                                                            res.send('Successfully updated movie entry');
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
                                                                                });
                                                                            });
                                                                        });
                                                                    });
                                                                });
                                                            });
                                                        }
                                                    });
                                                }
                                                beginInsert();
                                            });
                                        });
                                    });
                                });
                            }
        
                            // insert in node 3 first then replicate to central
                            else {
                                node3Pool.getConnection(function (err, node3Connection) {
                                    if (err) {
                                        throw err;
                                    }
        
                                    // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy node 3
                                    // node3Connection.destroy();
        
                                    node3Connection.ping(function (err) {
                                        // node 3 failed
                                        if (err) {
                                            console.log('Node 3 failed!');
                                            // should be in node 3 but node 3 is down --> unavailable all servers
                                            res.send('Servers are unavailable at the moment. Please try again later.');
                                        }
        
                                        node3Connection.query(setIsolationLevel, function (err) {
                                            if (err) {
                                                throw err;
                                            }

                                            node3Connection.query(sqlLogRead1, function (err, result) {
                                                if (err) throw err;
                                          
            
                                                function beginInsert() {
                                                    node3Connection.query(sqlLogRead1, function (err, result) {
                                                        let lock = result[0].lock_status;
                                                        const timeoutId = setTimeout(beginInsert, 1000);
                                                        if (lock == 1) {
                                                            if (timer == 100) {
                                                                console.log('Timeout');
                                                                clearTimeout(timeoutId);
                                                                res.send('Our servers are busy at the moment. Please try again later.');
                                                            }
                                                            console.log('Node locked');
                                                            timer = timer + 1;
                                                        } else {
                                                            console.log('Node free');
                                                            clearTimeout(timeoutId);
            
                                                          
                                                            let newStatement = `||| ${result[0].next_trans_record} ${sqlEntry}`;
                                                            let insertSQL = `${sqlEntry}`;
            
                                                            // result[0].id_new_entry = result[0].id_new_entry + 1;
            
                                                            // add id to statement string
                                                            // newStatement = insertSQL.slice(0, 85) + result[0].id_new_entry + ',' + insertSQL.slice(85);
                                                            // console.log('w/ id value: ' + newStatement);
                                                            // insertSQL = newStatement.substr(newStatement.indexOf('I'));
                                                            // console.log('tempstate:' + insertSQL);
            
                                                            // newStatement = `||| ${result[0].next_trans_record} ${newStatement}`;
            
                                                            // update log file values
                                                            result[0].lock_status = 1;
                                                            result[0].next_trans_record = result[0].next_trans_record + 1;
            
                                                           
            
                                                            if (result[0].statements == null) result[0].statements = newStatement;
                                                            else result[0].statements = result[0].statements + newStatement;
            
                                                           
            
                                                            const resultHolder = result[0];
            
                                                           
            
                                                            node3Connection.beginTransaction(function (err) {
                                                                if (err) {
                                                                    throw err;
                                                                }
            
                                                                console.log('Executing update log file query in node 3');
                                                                // update log file
                                                                node3Connection.query(sqlLog, [result[0].lock_status, result[0].next_trans_record, result[0].statements, 1], function (err, result) {
                                                                    if (err) {
                                                                        node3Connection.rollback(function () {
                                                                            throw err;
                                                                        });
                                                                    }
            
                                                                    console.log('Executing update log file commit in node 2');
                                                                    node3Connection.commit(function(err) {
                                                                        if (err) {
                                                                            node3Connection.rollback(function () {
                                                                                throw err;
                                                                            });
                                                                        }
                                                                        console.log('Update Committed');
                                                                        // begin transaction for updating movies table
                                                                        node3Connection.beginTransaction(function (err) {
                                                                            if (err) {
                                                                                throw err;
                                                                            }
            
                                                                            console.log('Executing update movies table query in node 3');
                                                                            // query for updating movies table using web app input
                                                                            node3Connection.query(insertSQL, function (err, result) {
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
                                                                                    console.log('Entry Insertion Successful!');
            
                                                                                    // start transaction to update next_trans_commit and id_new_entry in log file
                                                                                    node3Connection.beginTransaction(function (err) {
                                                                                        if (err) {
                                                                                            throw err;
                                                                                        }
                                                                                        const sqlLog = 'UPDATE log SET next_trans_commit=?, id_new_entry=? WHERE node_id=?';
                                                                                        // resultHolder.next_trans_commit = resultHolder.next_trans_commit + 1;
            
                                                              
            
                                                                                        // execute query to update next_trans_commit and id_new_entry in node 3 - central log file
                                                                                        console.log('Executing query to update next_trans_commit and id_new_entry in node 3 - central log file');
                                                                                        node3Connection.query(sqlLog, [resultHolder.next_trans_commit, resultHolder.id_new_entry, 1], function (err, result) {
                                                                                            if (err) {
                                                                                                node3Connection.rollback(function () {
                                                                                                    throw err;
                                                                                                });
                                                                                            }
            
                                                                                            console.log('Query successful! Committing to database');
                                                                                            node3Connection.commit(function (err) {
                                                                                                if (err) {
                                                                                                    node3Connection.rollback(function () {
                                                                                                        throw err;
                                                                                                    });
                                                                                                }
            
                                                                                                console.log('Begin query to read log file');
                                                                                                node3Connection.query(sqlLogRead1, function (err, result) {
                                                                                                    if (err) {
                                                                                                        node3Connection.rollback(function () {
                                                                                                            throw err;
                                                                                                        });
                                                                                                    }
            
                                                                                                    let statementStr = result[0].statements.split('||| ');
                                                                                            
                                                                                                    statementStr = statementStr[resultHolder.next_trans_record].substr(statementStr[resultHolder.next_trans_record].indexOf(' ') + 1);
                                                                                            
                                                                                                    console.log('Committing');
            
                                                                                                    node3Connection.commit(function (err) {
                                                                                                        if (err) {
                                                                                                            node3Connection.rollback(function () {
                                                                                                                throw err;
                                                                                                            });
                                                                                                        }
            
                                                                                                        const centralLog = resultHolder;
            
                                                                                                        console.log('Commit successful!');
                                                                          
                                                                                                        console.log(resultHolder);
            
                                                                                                        // begin transaction to read node 3 log file in node 2
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
            
                                                                                                                let node3Log = result;
            
                                                                                                                node3Connection.commit(function (err) {
                                                                                                                    if (err) {
                                                                                                                        node3Connection.rollback(function () {
                                                                                                                            throw err;
                                                                                                                        });
                                                                                                                    }
                                                                                                                 
            
                                                                                                                    node3Connection.beginTransaction(function (err) {
                                                                                                                        if (err) {
                                                                                                                            throw err;
                                                                                                                        }
                                                                                                                      
            
                                                                                                                        let node3Statement;
                                                                                                                        if (node3Log[0].statements == null) node3Statement = '||| ' + node3Log[0].next_trans_record + ' ' + statementStr;
                                                                                                                        else node3Statement = node3Log[0].statements + '||| ' + node3Log[0].next_trans_record + ' ' + statementStr;
            
                                                                                                                        node3Log[0].next_trans_record = node3Log[0].next_trans_record + 1;
                                                                                                                        node3Log[0].next_trans_commit = node3Log[0].next_trans_commit + 1;
                                                                                                                        node3Log[0].id_new_entry = resultHolder.id_new_entry;
                                                                                                                        node3Log[0].statements = node3Statement;
            
            
                                                                                                                        // execute query to change transaction record and id new entry + append statement for node3Log
                                                                                                                        node3Connection.query(sqlLogCommitId, [1, node3Log[0].next_trans_record, node3Log[0].next_trans_commit, node3Log[0].id_new_entry, node3Log[0].statements, 3], function (err, result) {
                                                                                                                            if (err) {
                                                                                                                                node3Connection.rollback(function () {
                                                                                                                                    throw err;
                                                                                                                                });
                                                                                                                            }
                                                                                                                            console.log('Next transaction record, id new entry, and statements updated! Node 3');
            
                                                                                                                            node3Connection.commit(function (err) {
                                                                                                                                if (err) {
                                                                                                                                    node3Connection.rollback(function () {
                                                                                                                                        throw err;
                                                                                                                                    });
                                                                                                                                }
            
                                                                                                                                // central node replication start
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
                                                                                                                                                newCentralConnection.ping(function(err) {
                                                                                                                                                    const timeoutId = setTimeout(beginCentralNode, 1000);
                                                                                                                                                    if (err) {
                                                                                                                                                        console.log('error');
                                                                                                                                                    } else {
                                                                                                                                                        console.log('connected');
                                                                                                                                                        clearTimeout(timeoutId);
            
                                                                                                                                                        newCentralConnection.query(setIsolationLevel, function (err) {
                                                                                                                                                            if (err) {
                                                                                                                                                                throw err;
                                                                                                                                                            }

                                                                                                                                                            // recovery for central node crash
                                                                                                                                                            node3Connection.beginTransaction(function(err) {
                                                                                                                                                                if (err) {
                                                                                                                                                                    throw err;
                                                                                                                                                                }
                
                                                                                                                                                                console.log('Extracting log files from node 3');
                                                                                                                                                                // query to get all log files from node 3
                                                                                                                                                                node3Connection.query(sqlLogReadAll, function(err, result) {
                                                                                                                                                                    if (err) {
                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                            throw err;
                                                                                                                                                                        });
                                                                                                                                                                    }
                
                                                                                                                                                                    const node3Logs = result;
                                                                                                                                                         
                
                                                                                                                                                                    node3Connection.commit(function(err) {
                                                                                                                                                                        if (err) {
                                                                                                                                                                            node3Connection.rollback(function() {
                                                                                                                                                                                throw err;
                                                                                                                                                                            });
                                                                                                                                                                        }
                
                                                                                                                                                                        // connect to node 2 to get log files and compare longest length with node 3 log file
                                                                                                                                                                        node2Pool.getConnection(function (err, node2Connection) {
                                                                                                                                                                            if (err) {
                                                                                                                                                                                throw err;
                                                                                                                                                                            }
                
                                                                                                                                                                            node2Connection.ping(function (err) {
                                                                                                                                                                                if (err) {
                                                                                                                                                                                    console.log('Node 2 failed!');
                                                                                                                                                                                }

                                                                                                                                                                                node2Connection.query(setIsolationLevel, function (err) {
                                                                                                                                                                                    if (err) {
                                                                                                                                                                                        throw err;
                                                                                                                                                                                    }
                
                                                                                                                                                                                    // query to get log files from node 3
                                                                                                                                                                                    node2Connection.query(sqlLogReadAll, function (err, result) {
                                                                                                                                                                                        if (err) {
                                                                                                                                                                                            node2Connection.rollback(function () {
                                                                                                                                                                                                throw err;
                                                                                                                                                                                            });
                                                                                                                                                                                        }
                    
                                                                                                                                                                                        const node2Logs = result;
                                                                                     
                    
                                                                                                                                                                                        node2Connection.commit(function (err) {
                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                node2Connection.rollback(function () {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                });
                                                                                                                                                                                            }
                                                                                                                                                                                            //
                                                                                                                                                                                            let finalNodeLogs = node3Logs;
                                                                                                                                                                                            if (node3Logs[0].next_trans_record < node2Logs[0].next_trans_record) {
                                                                                                                                                                                                finalNodeLogs[0] = node2Logs[0];
                                                                                                                                                                                            }
                                                                                                                                                                                            if (node3Logs[1].next_trans_record < node2Logs[1].next_trans_record) {
                                                                                                                                                                                                finalNodeLogs[1] = node2Logs[1];
                                                                                                                                                                                            }
                                                                                                                                                                                            if (node3Logs[2].next_trans_record < node2Logs[2].next_trans_record) {
                                                                                                                                                                                                finalNodeLogs[2] = node2Logs[2];
                                                                                                                                                                                            }
                    
                                                                                                   
                                                                                                                                                                                            newCentralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                }
                    
                                                                                                                                                                                                // update node 3 central log file to match central node
                                                                                                                                                                                                console.log('Executing query for update of node 3 for central log file');
                                                                                                                                                                                                newCentralConnection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                        newCentralConnection.rollback(function () {
                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                        });
                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                    // commit central node log file of node id 1
                                                                                                                                                                                                    console.log('Committing changes: central node update for central log file');
                                                                                                                                                                                                    newCentralConnection.commit(function (err) {
                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                            newCentralConnection.rollback(function () {
                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                            });
                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                        console.log('Commit success');
                    
                                                                                                                                                                                                        newCentralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                            // commit central node log file update of node id 3
                                                                                                                                                                                                            console.log('Executing query for central node update of node 3 log file');
                                                                                                                                                                                                            newCentralConnection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result) {
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
                    
                                                                                                                                                                                                                    console.log('Commit success');
                                                                                                                                                                                                                    console.log('Beginning statement extraction from node 2');
                                                                                                                                                                                                                    statementStr = finalNodeLogs[2].statements.split('||| ');
                                                                                                                                                                                                                   
                                                                                                                                                                                                                    statementStr = statementStr[finalNodeLogs[2].next_trans_record].substr(statementStr[finalNodeLogs[2].next_trans_record].indexOf(' ') + 1);
                                                       
                    
                                                                                                                                                                                                                    console.log('Start updating entry');
                                                                                                                                                                                                                    // get statement inputs
                                                                                                                                                                                                                    let entries = statementStr.slice(25);
                                                                                                                                                                                                                
                                                                                                                                                                                                                    entries = entries.split(',');
                                                                                                                                                                                                                    entries[0] = entries[0].slice(0, -1);   // title
                                                                                                                                                                                                                    entries[1] = entries[1].slice(7, -1);   // genre
                                                                                                                                                                                                                    entries[2] = entries[2].slice(7);       // rank
                                                                                                                                                                                                                    entries[3] = entries[3].slice(10, -1);  // director
                                                                                                                                                                                                                    entries[4] = entries[4].slice(8, -1);   // actor 1
                                                                                                                                                                                                                    let buffer = entries[5].split(' WHERE id=');
                                                                                                                                                                                                                    entries[5] = buffer[0].slice(8, -1);    // actor 2
                                                                                                                                                                                                                    entries[6] = buffer[1];        // id
                                                                                                                                                                                                                 
                                                                                                                                                                                                                   
                                                                                                                                                                                                                 
                                                                                                                                                                                                                    console.log('Executing query for central node update of movies table');
                                                                                                                                                                                                                    // update movies table in central node using statement
                                                                                                                                                                                                                    newCentralConnection.query(sqlEntryFill, [entries[0], entries[1], entries[2], entries[3], entries[4], entries[5], entries[6]], function (err, result) {
                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                            newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                            });
                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                        console.log('Update successful!');
                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                        newCentralConnection.commit(function (err) {
                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                });
                                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                                            console.log('Commit successful!');
                    
                                                                                                                                                                                                                            // update central node log file in central node
                                                                                                                                                                                                                            newCentralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                // increment next_trans_commit counter by 1
                                                                                                                                                                                                                                finalNodeLogs[0].next_trans_commit = finalNodeLogs[0].next_trans_commit + 1;
                    
                                                                                                                                                                                                                                // execute query to update next_trans_commit counter of node id 1 in central node log file
                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count of node id 1 in central node log file');
                                                                                                                                                                                                                                newCentralConnection.query(sqlLogNextCommit, [finalNodeLogs[0].next_trans_commit, 1], function (err, result) {
                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                        newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                    newCentralConnection.commit(function () {
                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                            newCentralConnection.rollback(function () {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                                        console.log('Commit successful!');
                    
                                                                                                                                                                                                                                        // update node id 1 log file in node 2
                                                                                                                                                                                                                                        node3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                                                            // execute query to update next_trans_commit counter of node id 1 in node 3 log file
                                                                                                                                                                                                                                            console.log('Executing query to update next transaction commit count of node id 1 in node 2 log file');
                                                                                                                                                                                                                                            node3Connection.query(sqlLogNextCommit, [finalNodeLogs[0].next_trans_commit, 1], function (err, result) {
                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                    node3Connection.rollback(function () {
                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                                console.log('Query Successful');
                                                                                                                                                                                                                                                console.log('Committing changes');
                                                                                                                                                                                                                                                node3Connection.commit(function (err) {
                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                                    console.log('Commit successful!');
                    
                                                                                                                                                                                                                                                    // update node id 1 log file in node 2
                                                                                                                                                                                                                                                    node2Connection.ping(function () {
                                                                                                                                                                                                                                                        // node 2 failed //
                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                            console.log('Node 3 failed!');
                                                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                                                        // node 3 available
                                                                                                                                                                                                                                                        else {
                                                                                                                                                                                                                                                            // execute query to update central node log file record in node 3
                                                                                                                                                                                                                                                            console.log('Executing query to update next transaction commit count for central node log file in node 2');
                                                                                                                                                                                                                                                            node2Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                                    node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                                                console.log('Query Successful');
                                                                                                                                                                                                                                                                console.log('Committing changes');
                                                                                                                                                                                                                                                                node2Connection.commit(function (err) {
                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                        node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                                                    console.log('Commit successful!');
                    
                                                                                                                                                                                                                                                                    node2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                                        }
                    
                                                                                                                                                                                                                                                                        // execute query to update node 2 log file record in node 3
                                                                                                                                                                                                                                                                        console.log('Executing query to update next transaction commit count for node 3 log file in node 2');
                                                                                                                                                                                                                                                                        node2Connection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result) {
                                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                                node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                            }
                    
                                                                                                                                                                                                                                                                            console.log('Query Successful');
                                                                                                                                                                                                                                                                            console.log('Committing changes');
                                                                                                                                                                                                                                                                            node2Connection.commit(function (err) {
                                                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                                                    node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                                }
                    
                                                                                                                                                                                                                                                                                console.log('Commit successful!');
                                                                                                                                                                                                                                                                                // start transaction to unlock node 3
                                                                                                                                                                                                                                                                                node3Connection.beginTransaction(function () {
                                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                                    }
                    
                                                                                                                                                                                                                                                                                    console.log('Executing query to unlock central node');
                                                                                                                                                                                                                                                                                    node3Connection.query(sqlUnlockAll, function (err, result) {
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
                    
                                                                                                                                                                                                                                                                                            console.log('Unlock committed');
                                                                                                                                                                                                                                                                                            res.send('Successfully updated movie entry');
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
                                                                                });
                                                                            });
                                                                        });
                                                                    });
                                                                });
                                                            });
                                                        }
                                                    });
                                                }
                                                beginInsert();
                                            });
                                        });
                                    });
                                });
                            }
                        }
                        // central node available
                        else {
                            console.log('Central node available!');
                         
                            centralConnection.query(setIsolationLevel, function (err) {
                                if (err) {
                                    throw err;
                                }

                                centralConnection.query(sqlLogRead1, function (err, result) {
                                    if (err) throw err;
                             
            
                                    function beginInsert() {
                                        centralConnection.query(sqlLogRead1, function (err, result) {
                                            let lock = result[0].lock_status;
                                            const timeoutId = setTimeout(beginInsert, 1000);
                                            if (lock == 1) {
                                                if (timer == 100) {
                                                    console.log('Timeout');
                                                    clearTimeout(timeoutId);
                                                    res.send('Our servers are busy at the moment. Please try again later.');
                                                }
                                                console.log('Node locked');
                                                timer = timer + 1;
                                            } else {
                                                console.log('Node free');
                                                clearTimeout(timeoutId);
            
                                        
            
                                                let newStatement = `||| ${result[0].next_trans_record} ${sqlEntry}`;
                                                let insertSQL = `${sqlEntry}`;
            
                                                // result[0].id_new_entry = result[0].id_new_entry + 1;
            
                                                // add id to statement string
                                                // newStatement = insertSQL.slice(0, 85) + result[0].id_new_entry + ',' + insertSQL.slice(85);
                                                // console.log('w/ id value: ' + newStatement);
                                                // insertSQL = newStatement.substr(newStatement.indexOf('I'));
                                                // console.log('tempstate:' + insertSQL);
            
                                                // newStatement = `||| ${result[0].next_trans_record} ${newStatement}`;
            
                                                // update log file values
                                                result[0].lock_status = 1;
                                                result[0].next_trans_record = result[0].next_trans_record + 1;
            
                                          
            
                                                if (result[0].statements == null) result[0].statements = newStatement;
                                                else result[0].statements = result[0].statements + newStatement;
            
                                        
            
                                                const resultHolder = result[0];
            
                                       
                                                centralConnection.beginTransaction(function (err) {
                                                    if (err) {
                                                        throw err;
                                                    }
            
                                                    console.log('Executing update log file query');
                                                    // update log file
                                                    centralConnection.query(sqlLog, [result[0].lock_status, result[0].next_trans_record, result[0].statements, 1], function (err, result) {
                                                        if (err) {
                                                            centralConnection.rollback(function () {
                                                                throw err;
                                                            });
                                                        }
                                                        console.log('Executing update log file commit');
                                                        centralConnection.commit(function (err) {
                                                            if (err) {
                                                                centralConnection.rollback(function () {
                                                                    throw err;
                                                                });
                                                            }
                                                            console.log('Update Committed');
            
                                                            // begin transaction for updating movies table
                                                            centralConnection.beginTransaction(function (err) {
                                                                if (err) {
                                                                    throw err;
                                                                }
            
                                                                console.log('Executing update movies table query');
                                                                // query for updating movies table
                                                         
                                                                centralConnection.query(insertSQL, function (err, result) {
                                                                    if (err) {
                                                                        centralConnection.rollback(function () {
                                                                            throw err;
                                                                        });
                                                                    }
            
                        

                                                                    // commit movies table update
                                                                    console.log('Executing update movies table commit');
                                                                    centralConnection.commit(function (err) {
                                                                        if (err) {
                                                                            centralConnection.rollback(function () {
                                                                                throw err;
                                                                            });
                                                                        }
            
                                                                        console.log('Entry Insertion Successful!');
            
                                                                        // start transaction to update next_trans_commit and id_new_entry in log file
                                                                        centralConnection.beginTransaction(function (err) {
                                                                            if (err) {
                                                                                throw err;
                                                                            }
                                                                            const sqlLog = 'UPDATE log SET next_trans_commit=?, id_new_entry=? WHERE node_id=?';
                                                                            resultHolder.next_trans_commit = resultHolder.next_trans_commit + 1;
            
                                                                            // execute query
                                                                            console.log('Executing query');
                                                                            centralConnection.query(sqlLog, [resultHolder.next_trans_commit, resultHolder.id_new_entry, 1], function (err, result) {
                                                                                if (err) {
                                                                                    centralConnection.rollback(function () {
                                                                                        throw err;
                                                                                    });
                                                                                }
            
                                                                                console.log('Query successful! Committing to database');
                                                                                centralConnection.commit(function (err) {
                                                                                    if (err) {
                                                                                        centralConnection.rollback(function () {
                                                                                            throw err;
                                                                                        });
                                                                                    }
            
                                                                                    console.log('Begin transaction to read log file');
                                                                                    centralConnection.beginTransaction(function (err) {
                                                                                        if (err) {
                                                                                            throw err;
                                                                                        }
            
                                                                                        console.log('Begin query to read log file');
                                                                                        centralConnection.query(sqlLogRead1, function (err, result) {
                                                                                            if (err) {
                                                                                                centralConnection.rollback(function () {
                                                                                                    throw err;
                                                                                                });
                                                                                            }
            
                                                                                            let statementStr = result[0].statements.split('||| ');
                                                                                    
                                                                                            statementStr = statementStr[resultHolder.next_trans_record].substr(statementStr[resultHolder.next_trans_record].indexOf(' ') + 1);
                                                        
                                                                                            centralConnection.commit(function (err) {
                                                                                                if (err) {
                                                                                                    centralConnection.rollback(function () {
                                                                                                        throw err;
                                                                                                    });
                                                                                                }
            
                                                                                                const centralLog = resultHolder;
            
                                                                                                // add id to statement string
                                                                                                console.log('Commit successful!');
            
                                                                                                // extract year from statement
                                                                                                // const tempStr = statementStr.split(',');
                                                                                                // const year = tempStr[9];
                                                                                                // console.log('YEAR: ' + year);
            
                                                                                                // add id to statement string
                                                                                                // statementStr = statementStr.slice(0, 91) + resultHolder.id_new_entry + ',' + statementStr.slice(91);
                                                                                          
            
                                                                                                // insert to Node 2 log file
                                                                                                if (year < 1980) {
                                                                                                    console.log('insert into node 2');
                                                                                                    centralConnection.beginTransaction(function (err) {
                                                                                                        if (err) {
                                                                                                            throw err;
                                                                                                        }
            
                                                                                                        // read log file in central node where node_id = 2
                                                                                                        centralConnection.query(sqlLogRead2, function (err, result) {
                                                                                                            if (err) {
                                                                                                                centralConnection.rollback(function () {
                                                                                                                    throw err;
                                                                                                                });
                                                                                                            }
            
                                                                                                            let node2Log = result;
            
                                                                                                            centralConnection.commit(function (err) {
                                                                                                                if (err) {
                                                                                                                    centralConnection.rollback(function () {
                                                                                                                        throw err;
                                                                                                                    });
                                                                                                                }
                                                                                                                console.log(node2Log);
            
                                                                                                                centralConnection.beginTransaction(function (err) {
                                                                                                                    if (err) {
                                                                                                                        throw err;
                                                                                                                    }
                                                             
            
                                                                                                                    let node2Statement;
                                                                                                                    if (node2Log[0].statements == null) node2Statement = '||| ' + node2Log[0].next_trans_record + ' ' + statementStr;
                                                                                                                    else node2Statement = node2Log[0].statements + '||| ' + node2Log[0].next_trans_record + ' ' + statementStr;
            
                                                                                                                    node2Log[0].next_trans_record = node2Log[0].next_trans_record + 1;
                                                                                                                    node2Log[0].id_new_entry = resultHolder.id_new_entry;
                                                                                                                    node2Log[0].statements = node2Statement;
            
                                                                    
            
                                                                                                                    // execute query to change transaction record and id new entry + append statement for node2Log
                                                                                                                    centralConnection.query(sqlLogId, [1, node2Log[0].next_trans_record, node2Log[0].id_new_entry, node2Log[0].statements, 2], function (err, result) {
                                                                                                                        if (err) {
                                                                                                                            centralConnection.rollback(function () {
                                                                                                                                throw err;
                                                                                                                            });
                                                                                                                        }
                                                                                                                        console.log('Next transaction record, id new entry, and statements updated! Node 2');
                                                                                                                        centralConnection.commit(function (err) {
                                                                                                                            if (err) {
                                                                                                                                centralConnection.rollback(function () {
                                                                                                                                    throw err;
                                                                                                                                });
                                                                                                                            }
            
                                                                                                                            // node 2 replication start
                                                                                                                            node2Pool.getConnection(function (err, node2Connection) {
                                                                                                                                if (err) {
                                                                                                                                    throw err;
                                                                                                                                }
            
                                                                                                                                // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy node 2
                                                                                                                                //node2Connection.destroy();
            
                                                                                                                                node2Connection.ping(function (err) {
                                                                                                                                    // node 2 failed
                                                                                                                                    if (err) {
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

                                                                                                                                                            // recovery for node 2 crash
                                                                                                                                                            centralConnection.beginTransaction(function (err) {
                                                                                                                                                                if (err) {
                                                                                                                                                                    throw err;
                                                                                                                                                                }
                
                                                                                                                                                                console.log('Extracting log files from central node');
                                                                                                                                                                // query to get log files from central node
                                                                                                                                                                centralConnection.query(sqlLogReadAll, function (err, result) {
                                                                                                                                                                    if (err) {
                                                                                                                                                                        centralConnection.rollback(function () {
                                                                                                                                                                            throw err;
                                                                                                                                                                        });
                                                                                                                                                                    }
                
                                                                                                                                                                    const centralLogs = result;
                                                                                                                        
                
                                                                                                                                                                    centralConnection.commit(function (err) {
                                                                                                                                                                        if (err) {
                                                                                                                                                                            centralConnection.rollback(function () {
                                                                                                                                                                                throw err;
                                                                                                                                                                            });
                                                                                                                                                                        }
                
                                                                                                                                                                        node3Pool.getConnection(function (err, node3Connection) {
                                                                                                                                                                            if (err) {
                                                                                                                                                                                throw err;
                                                                                                                                                                            }
                
                                                                                                                                                                            node3Connection.ping(function (err) {
                                                                                                                                                                                // node 3 failed
                                                                                                                                                                                if (err) {
                                                                                                                                                                                    console.log('Node 3 failed!');
                                                                                                                                                                                }
                                                                                                                                                                                // node 3 available
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
                
                                                                                                                                                                                        // query to get log files from node 3
                                                                                                                                                                                        node3Connection.query(sqlLogReadAll, function (err, result) {
                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                node3Connection.rollback(function () {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                });
                                                                                                                                                                                            }
                
                                                                                                                                                                                            const node3Logs = result;
                                                                                                                                                                                   
                
                                                                                                                                                                                            node3Connection.commit(function (err) {
                                                                                                                                                                                                if (err) {
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
                
                                                                                                                                                                               
                
                                                                                                                                                                                                // begin transaction to update log file in node 2
                                                                                                                                                                                                newNode2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                    }
                
                                                                                                                                                                                                    // update node 2 central log file to match central node
                                                                                                                                                                                                    console.log('Executing query for node 2 update of central log file');
                                                                                                                                                                                                    newNode2Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                            newNode2Connection.rollback(function () {
                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                            });
                                                                                                                                                                                                        }
                
                                                                                                                                                                                                        // commit node 2 log file of node id 1
                                                                                                                                                                                                        console.log('Committing node 2 update for central log file');
                                                                                                                                                                                                        newNode2Connection.commit(function (err) {
                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                newNode2Connection.rollback(function () {
                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                });
                                                                                                                                                                                                            }
                
                                                                                                                                                                                                            console.log('Commit success');
                
                                                                                                                                                                                                            newNode2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                // commit node 2 log file update of node id 2
                                                                                                                                                                                                                console.log('Committing node 2 update for node 2 log file');
                                                                                                                                                                                                                newNode2Connection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result) {
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
                
                                                                                                                                                                                                                        console.log('Commit success');
                
                                                                                                                                                                                                                        // get statement from node2Log
                                                                                                                                                                                                                        console.log('Beginning statement extraction from node 2');
                                                                                                                                                                                                                        statementStr = finalNodeLogs[1].statements.split('||| ');
                                                                                                                                                                                                                 
                                                                                                                                                                                                                        statementStr = statementStr[finalNodeLogs[1].next_trans_record].substr(statementStr[finalNodeLogs[1].next_trans_record].indexOf(' ') + 1);
                                               
                
                                                                                                                                                                                                                        console.log('Start updating entry');
                
                                                                                                                                                                                                                        // get statement inputs
                                                                                                                                                                                                                        let entries = statementStr.slice(25);
                                                                                                                                                                                                                  
                                                                                                                                                                                                                        entries = entries.split(',');
                                                                                                                                                                                                                        entries[0] = entries[0].slice(0, -1);   // title
                                                                                                                                                                                                                        entries[1] = entries[1].slice(7, -1);   // genre
                                                                                                                                                                                                                        entries[2] = entries[2].slice(7);       // rank
                                                                                                                                                                                                                        entries[3] = entries[3].slice(10, -1);  // director
                                                                                                                                                                                                                        entries[4] = entries[4].slice(8, -1);   // actor 1
                                                                                                                                                                                                                        let buffer = entries[5].split(' WHERE id=');
                                                                                                                                                                                                                        entries[5] = buffer[0].slice(8, -1);    // actor 2
                                                                                                                                                                                                                        entries[6] = buffer[1];        // id
                                                                                                                                                                                                                    
                                                                                                                                                                                                                       
                
                                                                                                                                                                                                                        // update movies table in node 2 using statement
                                                                                                                                                                                                                        newNode2Connection.query(sqlEntryFill, [entries[0], entries[1], entries[2], entries[3], entries[4], entries[5], entries[6]], function (err, result) {
                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                newNode2Connection.rollback(function () {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                });
                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                            console.log('Update successful!');
                                                                                                                                                                                                                            console.log('Committing changes');
                                                                                                                                                                                                                            newNode2Connection.commit(function (err) {
                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                    newNode2Connection.rollback(function () {
                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                console.log('Commit successful!');
                
                                                                                                                                                                                                                                // update node id 2 log file in node 2
                                                                                                                                                                                                                                newNode2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                    // increment next_trans_commit counter by 1
                                                                                                                                                                                                                                    finalNodeLogs[1].next_trans_commit = finalNodeLogs[1].next_trans_commit + 1;
                
                                                                                                                                                                                                                                    // execute query to update next_trans_commit counter of node id 2 in node 2 log file
                                                                                                                                                                                                                                    console.log('Executing query to update next transaction commit count of node id 2 in node 2 log file');
                                                                                                                                                                                                                                    newNode2Connection.query(sqlLogNextCommit, [finalNodeLogs[1].next_trans_commit, 2], function (err, result) {
                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                            newNode2Connection.rollback(function () {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                        console.log('Query Successful');
                                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                                        newNode2Connection.commit(function (err) {
                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                newNode2Connection.rollback(function () {
                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                            console.log('Commit successful!');
                
                                                                                                                                                                                                                                            // update node id 2 log file in central node
                                                                                                                                                                                                                                            centralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                                // execute query to update next_trans_commit counter of node id 2 in central node log file
                                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count of node id 2 in central node log file');
                                                                                                                                                                                                                                                centralConnection.query(sqlLogNextCommit, [finalNodeLogs[1].next_trans_commit, 2], function (err, result) {
                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                        centralConnection.rollback(function () {
                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                                    centralConnection.commit(function (err) {
                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                            centralConnection.rollback(function () {
                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                                        console.log('Commit successful!');
                
                                                                                                                                                                                                                                                        // update node id 2 log file in node 3
                                                                                                                                                                                                                                                        node3Connection.ping(function (err) {
                                                                                                                                                                                                                                                            // node 3 failed
                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                console.log('Node 3 failed!');
                                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                                            // node 3 available
                                                                                                                                                                                                                                                            else {
                                                                                                                                                                                                                                                                node3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                                                    // execute query to update central node log file record in node 3
                                                                                                                                                                                                                                                                    console.log('Executing query to update next transaction commit count for central node log file in node 3');
                                                                                                                                                                                                                                                                    node3Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                                            node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                                                        console.log('Query Successful');
                                                                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                                                                        node3Connection.commit(function (err) {
                                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                                node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                                                            console.log('Commit successful!');
                
                                                                                                                                                                                                                                                                            node3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                                                                // execute query to update node 2 log file record in node 3
                                                                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count for node 2 log file in node 3');
                                                                                                                                                                                                                                                                                node3Connection.query(sqlLogFull, [0, finalNodeLogs[1].next_trans_record, finalNodeLogs[1].next_trans_commit, finalNodeLogs[1].id_new_entry, finalNodeLogs[1].statements, 2], function (err, result) {
                                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                                                                    node3Connection.commit(function (err) {
                                                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                                                            node3Connection.rollback(function () {
                                                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                                                                        console.log('Commit successful!');
                
                                                                                                                                                                                                                                                                                        // start transaction to unlock central node
                                                                                                                                                                                                                                                                                        centralConnection.beginTransaction(function () {
                                                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                                                                            console.log('Executing query to unlock central node');
                                                                                                                                                                                                                                                                                            centralConnection.query(sqlUnlockAll, function (err, result) {
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
                
                                                                                                                                                                                                                                                                                                    console.log('Unlock committed');
                                                                                                                                                                                                                                                                                                    res.send('Successfully updated movie entry');
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
                                                                                                                                    // node 2 available
                                                                                                                                    else {
                                                                                                                                        node2Connection.beginTransaction(function (err) {
                                                                                                                                            if (err) {
                                                                                                                                                throw err;
                                                                                                                                            }
            
                                                                                                                                            // update node 2 central log file to match central node
                                                                                                                                            console.log('Executing query for node 2 update of central log file');
                                                                                                                                            node2Connection.query(sqlLogFull, [0, centralLog.next_trans_record, centralLog.next_trans_commit, centralLog.id_new_entry, centralLog.statements, 1], function (err, result) {
                                                                                                                                                if (err) {
                                                                                                                                                    node2Connection.rollback(function () {
                                                                                                                                                        throw err;
                                                                                                                                                    });
                                                                                                                                                }
            
                                                                                                                                                // commit node 2 log file of node id 1
                                                                                                                                                console.log('Committing node 2 update for central log file');
                                                                                                                                                node2Connection.commit(function (err) {
                                                                                                                                                    if (err) {
                                                                                                                                                        node2Connection.rollback(function () {
                                                                                                                                                            throw err;
                                                                                                                                                        });
                                                                                                                                                    }
            
                                                                                                                                                    console.log('Commit success');
            
                                                                                                                                                    node2Log = node2Log[0];
            
                                                                                                                                                    node2Connection.beginTransaction(function (err) {
                                                                                                                                                        if (err) {
                                                                                                                                                            throw err;
                                                                                                                                                        }
            
                                                                                                                                                        // commit node 2 log file update of node id 2
                                                                                                                                                        console.log('Committing node 2 update for node 2 log file');
                                                                                                                                                        node2Connection.query(sqlLogFull, [0, node2Log.next_trans_record, node2Log.next_trans_commit, node2Log.id_new_entry, node2Log.statements, 2], function (err, result) {
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
            
                                                                                                                                                                console.log('Commit success');
            
                                                                                                                                                                // get statement from node2Log
                                                                                                                                                                console.log('Beginning statement extraction from node 2');
                                                                                                                                                                statementStr = node2Log.statements.split('||| ');
                                                                                                                                                           
                                                                                                                                                                statementStr = statementStr[node2Log.next_trans_record].substr(statementStr[node2Log.next_trans_record].indexOf(' ') + 1);
                                                                                                                                                         
            
                                                                                                                                                                console.log('Start updating entry');
            
                                                                                                                                                                // get statement inputs
                                                                                                                                                                let entries = statementStr.slice(25);
                                                                                                                                                   
                                                                                                                                                                entries = entries.split(',');
                                                                                                                                                                entries[0] = entries[0].slice(0, -1);   // title
                                                                                                                                                                entries[1] = entries[1].slice(7, -1);   // genre
                                                                                                                                                                entries[2] = entries[2].slice(7);       // rank
                                                                                                                                                                entries[3] = entries[3].slice(10, -1);  // director
                                                                                                                                                                entries[4] = entries[4].slice(8, -1);   // actor 1
                                                                                                                                                                let buffer = entries[5].split(' WHERE id=');
                                                                                                                                                                entries[5] = buffer[0].slice(8, -1);    // actor 2
                                                                                                                                                                entries[6] = buffer[1];        // id
                                                                                                                                                                
                                                                                                                                                               
                                                                                                                                                  
            
                                                                                                                                                                // update movies table in node 2 using statement
                                                                                                                                                                node2Connection.query(sqlEntryFill, [entries[0], entries[1], entries[2], entries[3], entries[4], entries[5], entries[6]], function (err, result) {
                                                                                                                                                                    if (err) {
                                                                                                                                                                        node2Connection.rollback(function () {
                                                                                                                                                                            throw err;
                                                                                                                                                                        });
                                                                                                                                                                    }
                                                                                                                                                                    
                                                                                                                                                                    // console.log("CLICK!!!!!!!!!!!");
                                                                                                                                                                    node2Connection.query("DO SLEEP(0)", function(err){
                                                                                                                                                                        console.log('Update successful!');
                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                    node2Connection.commit(function (err) {
                                                                                                                                                                        if (err) {
                                                                                                                                                                            node2Connection.rollback(function () {
                                                                                                                                                                                throw err;
                                                                                                                                                                            });
                                                                                                                                                                        }
            
                                                                                                                                                                        console.log('Commit successful!');
            
                                                                                                                                                                        // update node id 2 log file in node 2
                                                                                                                                                                        node2Connection.beginTransaction(function (err) {
                                                                                                                                                                            if (err) {
                                                                                                                                                                                throw err;
                                                                                                                                                                            }
            
                                                                                                                                                                            // increment next_trans_commit counter by 1
                                                                                                                                                                            node2Log.next_trans_commit = node2Log.next_trans_commit + 1;
            
                                                                                                                                                                            // execute query to update next_trans_commit counter of node id 2 in node 2 log file
                                                                                                                                                                            console.log('Executing query to update next transaction commit count of node id 2 in node 2 log file');
                                                                                                                                                                            node2Connection.query(sqlLogNextCommit, [node2Log.next_trans_commit, 2], function (err, result) {
                                                                                                                                                                                if (err) {
                                                                                                                                                                                    node2Connection.rollback(function () {
                                                                                                                                                                                        throw err;
                                                                                                                                                                                    });
                                                                                                                                                                                }
            
                                                                                                                                                                                console.log('Query Successful');
                                                                                                                                                                                console.log('Committing changes');
                                                                                                                                                                                node2Connection.commit(function (err) {
                                                                                                                                                                                    if (err) {
                                                                                                                                                                                        node2Connection.rollback(function () {
                                                                                                                                                                                            throw err;
                                                                                                                                                                                        });
                                                                                                                                                                                    }
            
                                                                                                                                                                                    console.log('Commit successful!');
            
                                                                                                                                                                                    // update node id 2 log file in central node
                                                                                                                                                                                    centralConnection.beginTransaction(function (err) {
                                                                                                                                                                                        if (err) {
                                                                                                                                                                                            throw err;
                                                                                                                                                                                        }
            
                                                                                                                                                                                        // execute query to update next_trans_commit counter of node id 2 in central node log file
                                                                                                                                                                                        console.log('Executing query to update next transaction commit count of node id 2 in central node log file');
                                                                                                                                                                                        centralConnection.query(sqlLogNextCommit, [node2Log.next_trans_commit, 2], function (err, result) {
                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                centralConnection.rollback(function () {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                });
                                                                                                                                                                                            }
            
                                                                                                                                                                                            console.log('Query Successful');
                                                                                                                                                                                            console.log('Committing changes');
                                                                                                                                                                                            centralConnection.commit(function (err) {
                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                    centralConnection.rollback(function () {
                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                    });
                                                                                                                                                                                                }
            
                                                                                                                                                                                                console.log('Commit successful!');
            
                                                                                                                                                                                                // update node id 2 log file in node 3
                                                                                                                                                                                                node3Pool.getConnection(function (err, node3Connection) {
                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                    }
            
                                                                                                                                                                                                    node3Connection.ping(function (err) {
                                                                                                                                                                                                        // node 3 failed
                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                            console.log('Node 3 failed!');
                                                                                                                                                                                                        }
                                                                                                                                                                                                        // node 3 available
                                                                                                                                                                                                        else {
                                                                                                                                                                                                            node3Connection.query(setIsolationLevel, function (err) {
                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                }

                                                                                                                                                                                                                node3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                    // execute query to update central node log file record in node 3
                                                                                                                                                                                                                    console.log('Executing query to update next transaction commit count for central node log file in node 3');
                                                                                                                                                                                                                    node3Connection.query(sqlLogFull, [0, centralLog.next_trans_record, centralLog.next_trans_commit, centralLog.id_new_entry, centralLog.statements, 1], function (err, result) {
                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                            node3Connection.rollback(function () {
                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                            });
                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                        console.log('Query Successful');
                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                        node3Connection.commit(function (err) {
                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                node3Connection.rollback(function () {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                });
                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                            console.log('Commit successful!');
                
                                                                                                                                                                                                                            node3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                // execute query to update node 2 log file record in node 3
                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count for node 2 log file in node 3');
                                                                                                                                                                                                                                node3Connection.query(sqlLogFull, [0, node2Log.next_trans_record, node2Log.next_trans_commit, node2Log.id_new_entry, node2Log.statements, 2], function (err, result) {
                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                    node3Connection.commit(function (err) {
                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                            node3Connection.rollback(function () {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                        console.log('Commit successful!');
                
                                                                                                                                                                                                                                        // start transaction to unlock central node
                                                                                                                                                                                                                                        centralConnection.beginTransaction(function () {
                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                            console.log('Executing query to unlock central node');
                                                                                                                                                                                                                                            centralConnection.query(sqlUnlockAll, function (err, result) {
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
                
                                                                                                                                                                                                                                                    console.log('Unlock committed');
                                                                                                                                                                                                                                                    res.send('Successfully updated movie entry');
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
                                                                                                                                                                                                });
                                                                                                                                                                                            });
                                                                                                                                                                                        });
                                                                                                                                                                                    });
                                                                                                                                                                                });
                                                                                                                                                                            });
                                                                                                                                                                        });
                                                                                                                                                                    });
                                                                                                                                                                });
                                                                                                                                                                    })
            
                                                                                                                                                                    
                                                                                                                                                            });
                                                                                                                                                        });
                                                                                                                                                    });
                                                                                                                                                });
                                                                                                                                            });
                                                                                                                                        });
                                                                                                                                    }
                                                                                                                                });
                                                                                                                            });
                                                                                                                        });
                                                                                                                    });
                                                                                                                });
                                                                                                            });
                                                                                                        });
                                                                                                    });
                                                                                                }
                                                                                                // insert to Node 3 log file if >= 1980
                                                                                                else {
                                                                                                    console.log('insert into node 3');
                                                                                                    centralConnection.beginTransaction(function (err) {
                                                                                                        if (err) {
                                                                                                            throw err;
                                                                                                        }
            
                                                                                                        centralConnection.query(sqlLogRead3, function (err, result) {
                                                                                                            if (err) {
                                                                                                                centralConnection.rollback(function () {
                                                                                                                    throw err;
                                                                                                                });
                                                                                                            }
            
                                                                                                            let node3Log = result;
            
                                                                                                            centralConnection.commit(function (err) {
                                                                                                                if (err) {
                                                                                                                    centralConnection.rollback(function () {
                                                                                                                        throw err;
                                                                                                                    });
                                                                                                                }
                                                                                                                console.log(node3Log);
            
                                                                                                                centralConnection.beginTransaction(function (err) {
                                                                                                                    if (err) {
                                                                                                                        throw err;
                                                                                                                    }
                                                                                                               
            
                                                                                                                    let node3Statement;
                                                                                                                    if (node3Log[0].statements == null) node3Statement = '||| ' + node3Log[0].next_trans_record + ' ' + statementStr;
                                                                                                                    else node3Statement = node3Log[0].statements + '||| ' + node3Log[0].next_trans_record + ' ' + statementStr;
            
                                                                                                                    node3Log[0].next_trans_record = node3Log[0].next_trans_record + 1;
                                                                                                                    node3Log[0].id_new_entry = resultHolder.id_new_entry;
                                                                                                                    node3Log[0].statements = node3Statement;
            
                                                                                                                    centralConnection.query(sqlLogId, [1, node3Log[0].next_trans_record, node3Log[0].id_new_entry, node3Log[0].statements, 3], function (err, result) {
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
            
                                                                                                                            // node 3 replication start
                                                                                                                            node3Pool.getConnection(function (err, node3Connection) {
                                                                                                                                if (err) {
                                                                                                                                    throw err;
                                                                                                                                }
            
                                                                                                                                // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! destroy node 3
                                                                                                                                // node3Connection.destroy();
            
                                                                                                                                node3Connection.ping(function (err) {
                                                                                                                                    // node 3 failed
                                                                                                                                    if (err) {
                                                                                                                                        console.log('Node 3 failed!');
            
                                                                                                                                        let newNode3Connection;
            
                                                                                                                                        // set delay before reconnecting to node 2
                                                                                                                                        setTimeout(function () {
                                                                                                                                            node3Pool.getConnection(function (err, connection) {
                                                                                                                                                if (err) {
                                                                                                                                                    throw err;
                                                                                                                                                }
                                                                                                                                                newNode3Connection = connection;
                                                                                                                                                console.log('new connection established');
                                                                                                                                            });
                                                                                                                                        }, 5000); // change to 10000
            
                                                                                                                                        // periodic ping to check if connection is available
                                                                                                                                        function beginNode3() {
                                                                                                                                            if (newNode3Connection != undefined) {
                                                                                                                                                newNode3Connection.ping(function (err) {
                                                                                                                                                    const timeoutId = setTimeout(beginNode3, 1000);
                                                                                                                                                    if (err) {
                                                                                                                                                        console.log('error');
                                                                                                                                                    } else {
                                                                                                                                                        console.log('connected');
                                                                                                                                                        clearTimeout(timeoutId);
            
                                                                                                                                                        newNode3Connection.query(setIsolationLevel, function (err) {
                                                                                                                                                            if (err) {
                                                                                                                                                                throw err;
                                                                                                                                                            }

                                                                                                                                                            // recovery for node 2 crash
                                                                                                                                                            centralConnection.beginTransaction(function (err) {
                                                                                                                                                                if (err) {
                                                                                                                                                                    throw err;
                                                                                                                                                                }
                
                                                                                                                                                                console.log('Extracting log files from central node');
                                                                                                                                                                // query to get log files from central node
                                                                                                                                                                centralConnection.query(sqlLogReadAll, function (err, result) {
                                                                                                                                                                    if (err) {
                                                                                                                                                                        centralConnection.rollback(function () {
                                                                                                                                                                            throw err;
                                                                                                                                                                        });
                                                                                                                                                                    }
                
                                                                                                                                                                    const centralLogs = result;
                                                                                                                                                        
                
                                                                                                                                                                    centralConnection.commit(function (err) {
                                                                                                                                                                        if (err) {
                                                                                                                                                                            centralConnection.rollback(function () {
                                                                                                                                                                                throw err;
                                                                                                                                                                            });
                                                                                                                                                                        }
                
                                                                                                                                                                        node2Pool.getConnection(function (err, node2Connection) {
                                                                                                                                                                            if (err) {
                                                                                                                                                                                throw err;
                                                                                                                                                                            }
                
                                                                                                                                                                            node2Connection.ping(function (err) {
                                                                                                                                                                                // node 2 failed
                                                                                                                                                                                if (err) {
                                                                                                                                                                                    console.log('Node 2 failed!');
                                                                                                                                                                                }
                                                                                                                                                                                // node 2 available
                                                                                                                                                                                else {
                                                                                                                                                                                    console.log('Node 2 available!');
                
                                                                                                                                                                                    node2Connection.beginTransaction(function (err) {
                                                                                                                                                                                        if (err) {
                                                                                                                                                                                            throw err;
                                                                                                                                                                                        }
                
                                                                                                                                                                                        // query to get log files from node 2
                                                                                                                                                                                        node2Connection.query(sqlLogReadAll, function (err, result) {
                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                node2Connection.rollback(function () {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                });
                                                                                                                                                                                            }
                
                                                                                                                                                                                            const node2Logs = result;
                                                                                                                                                                       
                
                                                                                                                                                                                            node2Connection.commit(function (err) {
                                                                                                                                                                                                if (err) {
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
                
                                                                                                                                                                                               
                
                                                                                                                                                                                                // begin transaction to update log file in node 3
                                                                                                                                                                                                newNode3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                    }
                
                                                                                                                                                                                                    // update node 3 central log file to match central node
                                                                                                                                                                                                    console.log('Executing query for node 3 update of central log file');
                                                                                                                                                                                                    newNode3Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                            newNode3Connection.rollback(function () {
                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                            });
                                                                                                                                                                                                        }
                
                                                                                                                                                                                                        // commit node 2 log file of node id 1
                                                                                                                                                                                                        console.log('Committing node 3 update for central log file');
                                                                                                                                                                                                        newNode3Connection.commit(function (err) {
                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                newNode3Connection.rollback(function () {
                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                });
                                                                                                                                                                                                            }
                
                                                                                                                                                                                                            console.log('Commit success');
                
                                                                                                                                                                                                            newNode3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                // commit node 3 log file update of node id 3
                                                                                                                                                                                                                console.log('Committing node 3 update for node 3 log file');
                                                                                                                                                                                                                newNode3Connection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result) {
                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                        newNode3Connection.rollback(function () {
                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                        });
                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                    newNode3Connection.commit(function (err) {
                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                            newNode3Connection.rollback(function () {
                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                            });
                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                        console.log('Commit success');
                
                                                                                                                                                                                                                        // get statement from node2Log
                                                                                                                                                                                                                        console.log('Beginning statement extraction from node 3');
                                                                                                                                                                                                                        statementStr = finalNodeLogs[2].statements.split('||| ');
                                                                                                                                                                                                                       
                                                                                                                                                                                                                        statementStr = statementStr[finalNodeLogs[2].next_trans_record].substr(statementStr[finalNodeLogs[2].next_trans_record].indexOf(' ') + 1);
                                             
                
                                                                                                                                                                                                                        console.log('Start updating entry');
                
                                                                                                                                                                                                                        // get statement inputs
                                                                                                                                                                                                                        let entries = statementStr.slice(25);
                                                                                                                                                                                                                      
                                                                                                                                                                                                                        entries = entries.split(',');
                                                                                                                                                                                                                        entries[0] = entries[0].slice(0, -1);   // title
                                                                                                                                                                                                                        entries[1] = entries[1].slice(7, -1);   // genre
                                                                                                                                                                                                                        entries[2] = entries[2].slice(7);       // rank
                                                                                                                                                                                                                        entries[3] = entries[3].slice(10, -1);  // director
                                                                                                                                                                                                                        entries[4] = entries[4].slice(8, -1);   // actor 1
                                                                                                                                                                                                                        let buffer = entries[5].split(' WHERE id=');
                                                                                                                                                                                                                        entries[5] = buffer[0].slice(8, -1);    // actor 2
                                                                                                                                                                                                                        entries[6] = buffer[1];        // id
                                                                                                                                                                                                                    
                                                                                                                                                                                                                       
                                                                                                                                                                                                                   
                
                                                                                                                                                                                                                        // update movies table in node 3 using statement
                                                                                                                                                                                                                        newNode3Connection.query(sqlEntryFill, [entries[0], entries[1], entries[2], entries[3], entries[4], entries[5], entries[6]], function (err, result) {
                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                newNode3Connection.rollback(function () {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                });
                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                            console.log('Update successful!');
                                                                                                                                                                                                                            console.log('Committing changes');
                                                                                                                                                                                                                            newNode3Connection.commit(function (err) {
                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                    newNode3Connection.rollback(function () {
                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                console.log('Commit successful!');
                
                                                                                                                                                                                                                                // update node id 3 log file in node 3
                                                                                                                                                                                                                                newNode3Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                    // increment next_trans_commit counter by 1
                                                                                                                                                                                                                                    finalNodeLogs[2].next_trans_commit = finalNodeLogs[2].next_trans_commit + 1;
                
                                                                                                                                                                                                                                    // execute query to update next_trans_commit counter of node id 2 in node 2 log file
                                                                                                                                                                                                                                    console.log('Executing query to update next transaction commit count of node id 3 in node 3 log file');
                                                                                                                                                                                                                                    newNode3Connection.query(sqlLogNextCommit, [finalNodeLogs[2].next_trans_commit, 3], function (err, result) {
                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                            newNode3Connection.rollback(function () {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                        console.log('Query Successful');
                                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                                        newNode3Connection.commit(function (err) {
                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                newNode3Connection.rollback(function () {
                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                            console.log('Commit successful!');
                
                                                                                                                                                                                                                                            // update node id 3 log file in central node
                                                                                                                                                                                                                                            centralConnection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                                // execute query to update next_trans_commit counter of node id 3 in central node log file
                                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count of node id 3 in central node log file');
                                                                                                                                                                                                                                                centralConnection.query(sqlLogNextCommit, [finalNodeLogs[2].next_trans_commit, 3], function (err, result) {
                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                        centralConnection.rollback(function () {
                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                                    centralConnection.commit(function (err) {
                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                            centralConnection.rollback(function () {
                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                                        console.log('Commit successful!');
                
                                                                                                                                                                                                                                                        // update node id 3 log file in node 2
                                                                                                                                                                                                                                                        node2Connection.ping(function (err) {
                                                                                                                                                                                                                                                            // node 2 failed
                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                console.log('Node 3 failed!');
                                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                                            // node 2 available
                                                                                                                                                                                                                                                            else {
                                                                                                                                                                                                                                                                node2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                                                    // execute query to update central node log file record in node 2
                                                                                                                                                                                                                                                                    console.log('Executing query to update next transaction commit count for central node log file in node 2');
                                                                                                                                                                                                                                                                    node2Connection.query(sqlLogFull, [0, finalNodeLogs[0].next_trans_record, finalNodeLogs[0].next_trans_commit, finalNodeLogs[0].id_new_entry, finalNodeLogs[0].statements, 1], function (err, result) {
                                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                                            node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                                                        console.log('Query Successful');
                                                                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                                                                        node2Connection.commit(function (err) {
                                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                                node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                                                            console.log('Commit successful!');
                
                                                                                                                                                                                                                                                                            node2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                                                                // execute query to update node 3 log file record in node 2
                                                                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count for node 3 log file in node 2');
                                                                                                                                                                                                                                                                                node2Connection.query(sqlLogFull, [0, finalNodeLogs[2].next_trans_record, finalNodeLogs[2].next_trans_commit, finalNodeLogs[2].id_new_entry, finalNodeLogs[2].statements, 3], function (err, result) {
                                                                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                                                                        node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                                                                    node2Connection.commit(function (err) {
                                                                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                                                                            node2Connection.rollback(function () {
                                                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                                                                        console.log('Commit successful!');
                
                                                                                                                                                                                                                                                                                        // start transaction to unlock central node
                                                                                                                                                                                                                                                                                        centralConnection.beginTransaction(function () {
                                                                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                                                                            console.log('Executing query to unlock central node');
                                                                                                                                                                                                                                                                                            centralConnection.query(sqlUnlockAll, function (err, result) {
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
                
                                                                                                                                                                                                                                                                                                    console.log('Unlock committed');
                                                                                                                                                                                                                                                                                                    res.send('Successfully updated movie entry');
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
                                                                                                                                                                        });
                                                                                                                                                                    });
                                                                                                                                                                });
                                                                                                                                                            });
                                                                                                                                                        });
                                                                                                                                                    }
                                                                                                                                                });
                                                                                                                                            } else {
                                                                                                                                                setTimeout(beginNode3, 1000);
                                                                                                                                                console.log('Attempting to reconnect to node');
                                                                                                                                            }
                                                                                                                                        }
                                                                                                                                        beginNode3();
                                                                                                                                    }
                                                                                                                                    // node 3 available
                                                                                                                                    else {
                                                                                                                                        node3Connection.beginTransaction(function (err) {
                                                                                                                                            if (err) {
                                                                                                                                                throw err;
                                                                                                                                            }
            
                                                                                                                                            // update node 3 central log file to match central node
                                                                                                                                            console.log('Executing query for node 3 update of central log file');
                                                                                                                                            node3Connection.query(sqlLogFull, [0, centralLog.next_trans_record, centralLog.next_trans_commit, centralLog.id_new_entry, centralLog.statements, 1], function (err, result) {
                                                                                                                                                if (err) {
                                                                                                                                                    node3Connection.rollback(function () {
                                                                                                                                                        throw err;
                                                                                                                                                    });
                                                                                                                                                }
            
                                                                                                                                                // commit node 3 central log file update
                                                                                                                                                console.log('Committing node 3 update for central log file');
                                                                                                                                                node3Connection.commit(function (err) {
                                                                                                                                                    if (err) {
                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                            throw err;
                                                                                                                                                        });
                                                                                                                                                    }
            
                                                                                                                                                    console.log('Commit success');
            
                                                                                                                                                    node3Log = node3Log[0];
            
                                                                                                                                                    node3Connection.beginTransaction(function (err) {
                                                                                                                                                        if (err) {
                                                                                                                                                            throw err;
                                                                                                                                                        }
            
                                                                                                                                                        // commit node 3 log file update of node id 3
                                                                                                                                                        console.log('Committing node 3 update for node 3 log file');
                                                                                                                                                        node3Connection.query(sqlLogFull, [0, node3Log.next_trans_record, node3Log.next_trans_commit, node3Log.id_new_entry, node3Log.statements, 3], function (err, result) {
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
            
                                                                                                                                                                console.log('Commit success');
            
                                                                                                                                                                // get statement from node3Log
                                                                                                                                                                console.log('Beginning statement extraction from node 3');
                                                                                                                                                                statementStr = node3Log.statements.split('||| ');
                                                                                                                                                            
                                                                                                                                                                statementStr = statementStr[node3Log.next_trans_record].substr(statementStr[node3Log.next_trans_record].indexOf(' ') + 1);
                                                                                                                                                       
            
                                                                                                                                                                console.log('Start updating entry');
            
                                                                                                                                                                // get statement inputs
                                                                                                                                                                let entries = statementStr.slice(25);
                                                                                                                                                             
                                                                                                                                                                entries = entries.split(',');
                                                                                                                                                                entries[0] = entries[0].slice(0, -1);   // title
                                                                                                                                                                entries[1] = entries[1].slice(7, -1);   // genre
                                                                                                                                                                entries[2] = entries[2].slice(7);       // rank
                                                                                                                                                                entries[3] = entries[3].slice(10, -1);  // director
                                                                                                                                                                entries[4] = entries[4].slice(8, -1);   // actor 1
                                                                                                                                                                let buffer = entries[5].split(' WHERE id=');
                                                                                                                                                                entries[5] = buffer[0].slice(8, -1);    // actor 2
                                                                                                                                                                entries[6] = buffer[1];        // id
                                                                                                                                                            
                                                                                                                                                                
                                                                                                                                                             
            
                                                                                                                                                                // update movies table in node 2 using statement
                                                                                                                                                                node3Connection.query(sqlEntryFill, [entries[0], entries[1], entries[2], entries[3], entries[4], entries[5], entries[6]], function (err, result) {
                                                                                                                                                                    if (err) {
                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                            throw err;
                                                                                                                                                                        });
                                                                                                                                                                    }
                                                                                                                                                                    console.log('Update successful!');
                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                    node3Connection.commit(function (err) {
                                                                                                                                                                        if (err) {
                                                                                                                                                                            node3Connection.rollback(function () {
                                                                                                                                                                                throw err;
                                                                                                                                                                            });
                                                                                                                                                                        }
            
                                                                                                                                                                        console.log('Commit successful!');
            
                                                                                                                                                                        // update node id 3 log file in node 3
                                                                                                                                                                        node3Connection.beginTransaction(function (err) {
                                                                                                                                                                            if (err) {
                                                                                                                                                                                throw err;
                                                                                                                                                                            }
            
                                                                                                                                                                            // increment next_trans_commit counter by 1
                                                                                                                                                                            node3Log.next_trans_commit = node3Log.next_trans_commit + 1;
            
                                                                                                                                                                            // execute query to update next_trans_commit counter in node 3 log file
                                                                                                                                                                            console.log('Executing query to update next transaction commit count of node id 3 in node 3 log file');
                                                                                                                                                                            node3Connection.query(sqlLogNextCommit, [node3Log.next_trans_commit, 3], function (err, result) {
                                                                                                                                                                                if (err) {
                                                                                                                                                                                    node3Connection.rollback(function () {
                                                                                                                                                                                        throw err;
                                                                                                                                                                                    });
                                                                                                                                                                                }
            
                                                                                                                                                                                console.log('Query Successful');
                                                                                                                                                                                console.log('Committing changes');
                                                                                                                                                                                node3Connection.commit(function (err) {
                                                                                                                                                                                    if (err) {
                                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                                            throw err;
                                                                                                                                                                                        });
                                                                                                                                                                                    }
            
                                                                                                                                                                                    console.log('Commit successful!');
            
                                                                                                                                                                                    // update node id 3 log file in central node
                                                                                                                                                                                    centralConnection.beginTransaction(function (err) {
                                                                                                                                                                                        if (err) {
                                                                                                                                                                                            throw err;
                                                                                                                                                                                        }
            
                                                                                                                                                                                        // execute query to update next_trans_commit counter of node id 3 in central node log file
                                                                                                                                                                                        console.log('Executing query to update next transaction commit count of node id 3 in central node log file');
                                                                                                                                                                                        centralConnection.query(sqlLogNextCommit, [node3Log.next_trans_commit, 3], function (err, result) {
                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                centralConnection.rollback(function () {
                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                });
                                                                                                                                                                                            }
            
                                                                                                                                                                                            console.log('Query Successful');
                                                                                                                                                                                            console.log('Committing changes');
                                                                                                                                                                                            centralConnection.commit(function (err) {
                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                    centralConnection.rollback(function () {
                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                    });
                                                                                                                                                                                                }
            
                                                                                                                                                                                                console.log('Commit successful!');
            
                                                                                                                                                                                                // update node id 3 log file in node 2
                                                                                                                                                                                                node2Pool.getConnection(function (err, node2Connection) {
                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                    }
            
                                                                                                                                                                                                    node2Connection.ping(function (err) {
                                                                                                                                                                                                        // node 2 failed
                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                            console.log('Node 2 failed!');
                                                                                                                                                                                                        }
                                                                                                                                                                                                        // node 2 available
                                                                                                                                                                                                        else {
                                                                                                                                                                                                            node2Connection.query(setIsolationLevel, function (err) {
                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                }

                                                                                                                                                                                                                node2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                        throw err;
                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                    // execute query to update next_trans_commit counter of node id 3 in central node log file
                                                                                                                                                                                                                    console.log('Executing query to update next transaction commit count of node id 2 in node 2 log file');
                                                                                                                                                                                                                    node2Connection.query(sqlLogFull, [0, centralLog.next_trans_record, centralLog.next_trans_commit, centralLog.id_new_entry, centralLog.statements, 1], function (err, result) {
                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                            node3Connection.rollback(function () {
                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                            });
                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                        console.log('Query Successful');
                                                                                                                                                                                                                        console.log('Committing changes');
                                                                                                                                                                                                                        node2Connection.commit(function (err) {
                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                node2Connection.rollback(function () {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                });
                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                            console.log('Commit successful!');
                
                                                                                                                                                                                                                            node2Connection.beginTransaction(function (err) {
                                                                                                                                                                                                                                if (err) {
                                                                                                                                                                                                                                    throw err;
                                                                                                                                                                                                                                }
                
                                                                                                                                                                                                                                // execute query to update next_trans_commit counter of node id 3 in node 2 log file
                                                                                                                                                                                                                                console.log('Executing query to update next transaction commit count of node id 3 in node 2 log file');
                                                                                                                                                                                                                                node2Connection.query(sqlLogFull, [0, node3Log.next_trans_record, node3Log.next_trans_commit, node3Log.id_new_entry, node3Log.statements, 3], function (err, result) {
                                                                                                                                                                                                                                    if (err) {
                                                                                                                                                                                                                                        node3Connection.rollback(function () {
                                                                                                                                                                                                                                            throw err;
                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                    }
                
                                                                                                                                                                                                                                    console.log('Query Successful');
                                                                                                                                                                                                                                    console.log('Committing changes');
                                                                                                                                                                                                                                    node2Connection.commit(function (err) {
                                                                                                                                                                                                                                        if (err) {
                                                                                                                                                                                                                                            node2Connection.rollback(function () {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                        }
                
                                                                                                                                                                                                                                        console.log('Commit successful!');
                
                                                                                                                                                                                                                                        // start transaction to unlock central node
                                                                                                                                                                                                                                        centralConnection.beginTransaction(function () {
                                                                                                                                                                                                                                            if (err) {
                                                                                                                                                                                                                                                throw err;
                                                                                                                                                                                                                                            }
                
                                                                                                                                                                                                                                            console.log('Executing query to unlock central node');
                                                                                                                                                                                                                                            centralConnection.query(sqlUnlockAll, function (err, result) {
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
                
                                                                                                                                                                                                                                                    console.log('Unlock committed');
                                                                                                                                                                                                                                                    res.send('Successfully updated movie entry');
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
                                                                                                                            });
                                                                                                                        });
                                                                                                                    });
                                                                                                                });
                                                                                                            });
                                                                                                        });
                                                                                                    });
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
                                    beginInsert();
                                });
                            });
                        }
                    });
                });
            })
        });
    }
};

module.exports = updateController;
