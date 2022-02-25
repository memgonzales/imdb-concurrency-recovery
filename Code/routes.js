const express = require('express');
const homeController = require('./controllers/homeController.js');
const centralNodeController = require('./controllers/centralNodeController.js');
const node2Controller = require('./controllers/node2Controller.js');
const node3Controller = require('./controllers/node3Controller.js');
const insertController = require('./controllers/insertController.js');
const deleteController = require('./controllers/deleteController.js');
const updateController = require('./controllers/updateController.js');
const globalFailureCase1Controller = require('./controllers/globalFailureCase1Controller.js');
const globalFailureCase2Controller = require('./controllers/globalFailureCase2Controller.js');
const globalFailureCase3Controller = require('./controllers/globalFailureCase3Controller.js');
const globalFailureCase4Controller = require('./controllers/globalFailureCase4Controller.js');
const extraSearchFailureController = require('./controllers/extraSearchFailureController.js');

const app = express();

app.get('/', homeController.getView);

// Home Routes
app.get('/searchEntry', homeController.searchEntry);
app.post('/addEntry', insertController.insertEntry);
app.post('/deleteEntry', deleteController.deleteEntry);
app.post('/updateEntry', updateController.updateEntry);

// Node 1 Routes
app.get('/getCentralNode', centralNodeController.getView);
// app.post('/addEntry', centralNodeController.addEntry);
// app.post('/updateEntry', centralNodeController.updateEntry);
// app.post('/deleteEntry', centralNodeController.deleteEntry);

// Node 2 Routes
app.get('/getNode2', node2Controller.getView);
// app.post('/addEntryNode2', node2Controller.addEntry);
// app.post('/updateEntryNode2', node2Controller.updateEntry);
// app.post('/deleteEntryNode2', node2Controller.deleteEntry);

// Node 3 Routes
app.get('/getNode3', node3Controller.getView);
// app.post('/addEntryNode3', node3Controller.addEntry);
// app.post('/updateEntryNode3', node3Controller.updateEntry);
// app.post('/deleteEntryNode3', node3Controller.deleteEntry);

// Global Failure Recovery Case 1 Routes
app.post('/case1Insert1', globalFailureCase1Controller.case1Insert1);
app.post('/case1Update', globalFailureCase1Controller.case1Update);
app.post('/case1Delete', globalFailureCase1Controller.case1Delete);

// Global Failure Recovery Case 2 Routes
app.post('/case2Insert1', globalFailureCase2Controller.case2Insert1);
app.post('/case2Insert2', globalFailureCase2Controller.case2Insert2);
app.post('/case2Update1', globalFailureCase2Controller.case2Update1);
app.post('/case2Update2', globalFailureCase2Controller.case2Update2);
app.post("/case2Delete1", globalFailureCase2Controller.case2Delete1);
app.post('/case2Delete2', globalFailureCase2Controller.case2Delete2)

// Global Failure Recovery Case 3 Routes
app.get('/case3Select', globalFailureCase3Controller.case3Select);
app.post('/case3Insert', globalFailureCase3Controller.case3Insert);
app.post('/case3Update', globalFailureCase3Controller.case3Update);
app.post('/case3Delete', globalFailureCase3Controller.case3Delete);

// Global Failure Recovery Case 4 Routes
app.get('/case4Select', globalFailureCase4Controller.case4Select);
app.get('/case4Select2', globalFailureCase4Controller.case4Select2);
app.post('/case4Insert1', globalFailureCase4Controller.case4Insert1);
app.post('/case4Insert2', globalFailureCase4Controller.case4Insert2);
app.post('/case4Update1', globalFailureCase4Controller.case4Update1);
app.post('/case4Update2', globalFailureCase4Controller.case4Update2);
app.post('/case4Delete1', globalFailureCase4Controller.case4Delete1);
app.post('/case4Delete2', globalFailureCase4Controller.case4Delete2);

// Extra Search Failure Recovery Routes
app.get('/extraSelect1', extraSearchFailureController.extraSelect1);
app.get('/extraSelect2', extraSearchFailureController.extraSelect2);
app.get('/extraSelect3', extraSearchFailureController.extraSelect3);


module.exports = app;
