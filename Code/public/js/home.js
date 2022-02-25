$(function () {
	$('select').hide();
	$('.results-table').DataTable();
	$('[data-toggle="tooltip"]').tooltip();

	$('#test-container').hide();
	$('#access-nodes').hide();
	$('#demo-btn').on('click', function () {
		if ($('#test-container').is(':visible')) {
			$('#test-container').hide();
			$('#access-nodes').hide();
		} else {
			$('#test-container').show();
			$('#access-nodes').show();
		}
	});

	/* ================================ FEATURE BUTTONS ================================ */

	/* Search the database. */
	$('#search-btn').on('click', function (e) {
		const isolationLevel = $('#isolation-level :selected').val();
		$('#search-form-isolation-level').val(isolationLevel);

		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/searchEntry',
			type: 'GET',
			data: $('#search-form').serialize(),
			success: function (data) {
				updateTable(data[0]);
				updateStatus(data[1]);
				$('body').scrollTop(120);
			}
		});
	});

	/* Add a new entry. */
	$('#add-entry-btn').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/addEntry',
			type: 'POST',
			data: $('#add-entry-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Update an entry. */
	$('#update-btn').on('click', function (e) {
		const isolationLevel = $('#isolation-level :selected').val();
		$('#update-entry-form-isolation-level').val(isolationLevel);

		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/updateEntry',
			type: 'POST',
			data: $('#update-entry-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Delete a new entry. */
	$('#delete-btn').on('click', function (e) {
		const isolationLevel = $('#isolation-level :selected').val();
		$('#delete-entry-form-isolation-level').val(isolationLevel);

		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/deleteEntry',
			type: 'POST',
			data: $('#deleteEntryForm').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* ================================ SELECT BUTTONS ================================ */

	/* Case 3 Select. */
	$('#case3Select-btn').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case3Select',
			type: 'GET',
			data: $('#failure-select-form').serialize(),
			success: function (data) {
				updateTable(data[0]);
				updateStatus(data[1]);
				$('body').scrollTop(0);
			}
		});
	});

	/* Case 4 Select. */
	$('#case4Select-btn').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case4Select',
			type: 'GET',
			data: $('#failure-select-form').serialize(),
			success: function (data) {
				updateTable(data[0]);
				updateStatus(data[1]);
				$('body').scrollTop(0);
			}
		});
	});

	/* Case 4 Select Node 3. */
	$('#case4Select-btn2').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case4Select2',
			type: 'GET',
			data: $('#failure-select-form').serialize(),
			success: function (data) {
				updateTable(data[0]);
				updateStatus(data[1]);
				$('body').scrollTop(0);
			}
		});
	});

	/* Extra Select 1 (Central Node + Node 2). */
	$('#extraSelect-btn1').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/extraSelect1',
			type: 'GET',
			data: $('#failure-select-form').serialize(),
			success: function (data) {
				updateTable(data[0]);
				updateStatus(data[1]);
				$('body').scrollTop(0);
			}
		});
	});

	/* Extra Select 2 (Central Node + Node 3). */
	$('#extraSelect-btn2').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/extraSelect2',
			type: 'GET',
			data: $('#failure-select-form').serialize(),
			success: function (data) {
				updateTable(data[0]);
				updateStatus(data[1]);
				$('body').scrollTop(0);
			}
		});
	});

	/* Extra Select 3 (Node 2 + Node 3). */
	$('#extraSelect-btn3').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/extraSelect3',
			type: 'GET',
			data: $('#failure-select-form').serialize(),
			success: function (data) {
				updateTable(data[0]);
				updateStatus(data[1]);
				$('body').scrollTop(0);
			}
		});
	});

	/* ================================ INSERT BUTTONS ================================ */

	/* Case 1a - Failure Replicating to Central Node from Node 2 */
	$('#insert-btn-1a').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case1Insert1',
			type: 'POST',
			data: $('#failure-insert-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 2a - Failure Replicating to Node 2 from Central Node */
	$('#insert-btn-2a').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case2Insert1',
			type: 'POST',
			data: $('#failure-insert-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 2b - Failure Replicating to Node 3 from Central Node */
	$('#insert-btn-2b').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case2Insert2',
			type: 'POST',
			data: $('#failure-insert-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 3 - Central Node Unavailable */
	$('#insert-btn-3').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case3Insert',
			type: 'POST',
			data: $('#failure-insert-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 4a - Node 2 Unavailable */
	$('#insert-btn-4a').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case4Insert1',
			type: 'POST',
			data: $('#failure-insert-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 4b - Node 3 Unavailable */
	$('#insert-btn-4b').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case4Insert2',
			type: 'POST',
			data: $('#failure-insert-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* ================================ UPDATE BUTTONS ================================ */
	/* Case 1 - Failure while Replicating to Central Node from Node 2 or Node 3 */
	$('#update-btn-1').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$('#hidden-isolation-level').val($('#isolation-level').val());

		$.ajax({
			url: '/case1Update',
			type: 'POST',
			data: $('#failure-update-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 2a - Failure while Replicating to Node 2 from Central Node*/
	$('#update-btn-2a').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$('#hidden-isolation-level').val($('#isolation-level').val());

		$.ajax({
			url: '/case2Update1',
			type: 'POST',
			data: $('#failure-update-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 2b - Failure while Replicating to Node 3 from Central Node*/
	$('#update-btn-2b').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$('#hidden-isolation-level').val($('#isolation-level').val());

		$.ajax({
			url: '/case2Update2',
			type: 'POST',
			data: $('#failure-update-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 3 - Central Node Unavailable*/
	$('#update-btn-3').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$('#hidden-isolation-level').val($('#isolation-level').val());

		$.ajax({
			url: '/case3Update',
			type: 'POST',
			data: $('#failure-update-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 4a - Node 2 Unavailable*/
	$('#update-btn-4a').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$('#hidden-isolation-level').val($('#isolation-level').val());

		$.ajax({
			url: '/case4Update1',
			type: 'POST',
			data: $('#failure-update-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 4b - Node 3 Unavailable*/
	$('#update-btn-4b').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$('#hidden-isolation-level').val($('#isolation-level').val());

		$.ajax({
			url: '/case4Update2',
			type: 'POST',
			data: $('#failure-update-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* ================================ DELETE BUTTONS ================================ */
	/* Case 1 - Failure Replicating to Central Node from Node 2/3*/
	$('#delete-case1').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case1Delete',
			type: 'POST',
			data: $('#failure-delete-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 2a - Failure Replicating to Node 2 from Central Node*/
	$('#delete-case2a').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case2Delete1',
			type: 'POST',
			data: $('#failure-delete-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 2b - Failure Replicating to Node 3 from Central Node*/
	$('#delete-case2b').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case2Delete2',
			type: 'POST',
			data: $('#failure-delete-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 3 - Central Node Unavailable*/
	$('#delete-case3').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case3Delete',
			type: 'POST',
			data: $('#failure-delete-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 4a - Node 2 Unavailable*/
	$('#delete-case4a').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case4Delete1',
			type: 'POST',
			data: $('#failure-delete-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	/* Case 4b - Node 3 Unavailable*/
	$('#delete-case4b').on('click', function (e) {
		/* Override the default submit behavior and insert AJAX. */
		e.preventDefault();

		$.ajax({
			url: '/case4Delete2',
			type: 'POST',
			data: $('#failure-delete-form').serialize(),
			success: function (data) {
				/* Display data only if it the first character is a letter. */
				if (data[0].toUpperCase() != data[0].toLowerCase()) alert(data);
			}
		});
	});

	function updateTable(results) {
		$('#results-table').DataTable().clear().draw();

		for (const result of results) {
			$('#results-table').DataTable().row.add([result.id, result.name, result.year, result.genre, result.rank, result.director, result.actor1, result.actor2]).draw(false);
		}
	}

	function updateStatus(resultStatus) {
		$('#result-status').text(resultStatus);
	}
});
