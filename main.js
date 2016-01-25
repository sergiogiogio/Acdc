var assert = require('assert');

var Api = require("./api");

var token = require("./token.json");

var session = new Api.Session(token);

var fs = require("fs");
var crypto = require("crypto");

//recreate token:
// https://www.amazon.com/ap/oa?client_id=amzn1.application-oa2-client.d1f16785649d4f5099fd3c95ecf6047b&scope=clouddrive%3Aread_all%20clouddrive%3Awrite&response_type=code&redirect_uri=https://acdc-1163.appspot.com


/*session.account_endpoint(function(err, result) {
	console.log("endpoint: %j, %j", err, result);
});*/

/*
session.list("kind:FOLDER AND isRoot:true", function(err, result) {
	console.log("session.list \"kind:FOLDER AND isRoot:true\": %j, %j", err ? err.message : "", result);
});
*/

/*
session.list("kind:FOLDER", function(err, result) {
	console.log("session.list \"kind:FOLDER\": %j, %j", err ? err.message : "", result);
});
*/


/*//session.list("kind:FOLDER AND isRoot:true", function(err, result) {
//session.list("kind:FOLDER", function(err, result) {
session.resolve_path("/Picturesw", function(err, result) {
	console.log("resolve_path: %j, %j", err ? err.message : "", result);
});
*/

/*session.upload(null, "test2", function(err, result) {
	console.log("upload: %j, %j", err ? err.message : "", result);
});*/

/*session.list("name:test2", function(err, result) {
	console.log("session.list \"name:test2\": %j, %j", err ? err.message : "", result);
	console.log(result.data[0].id);
	session.overwrite(result.data[0].id, "test2", function(err, result) {
		console.log("overwrite: %j, %j", err ? err.message : "", result);
	});
});*/


/*session.list("name:test2", function(err, result) {
	console.log("session.list \"name:test2\": %j, %j", err ? err.message : "", result);
	console.log(result.data[0].id);
	session.download(result.data[0].id, function(err, result) {
		console.log("overwrite: %j, %j", err ? err.message : "", result);
	});
});*/


/*session.list("name:test2", function(err, result) {
	console.log("session.list \"name:test2\": %j, %j", err ? err.message : "", result);
	console.log(result.data[0].id);
	session.download(result.data[0].id, process.stdout, function(err, result) {
		console.log("download: %j", err ? err.message + "\n" + err.stack : "");
	});
});*/


/*session.create_folder({ name: "test-folder", kind: "FOLDER" }, function(err, result) {
	console.log("create_folder: %j, %j", err ? err.message : "", result);
});*/

/*
session.resolve_path("/test2", function(err, target) {
	console.log("resolve_path(target): %j, %j", err ? err.message : "", target);
	if(err || target.count === 0) return;
	session.resolve_path("/test-folder", function(err, parent) {
		console.log("resolve_path(parent): %j, %j", err ? err.message : "", parent);
		if(err || parent.count === 0) return;
		session.add_child(parent.data[0].id, target.data[0].id, function(err, result) {
			console.log("add_child: %j, %j", err ? err.message : "", result);
		});
	});
});*/

/*
create folder - check it exists
upload file to folder - download to verify
overwrite file - download to verify
create sub-folder - check it exists
move file to sub-folder - check it exists
delete file - check it does not exist
delete folder - check it does not exist
*/


/*session.create_folder({ name: "test-folder", kind: "FOLDER" }, function(err, result) {
	console.log("create_folder: %j, %j", err ? err.message : "", result);
	assert.equal(err, null, "Folder could not be created");
});*/
session.resolve_path("/AcdcTests", function(err, folders) {
	console.log("resolve_path: %s, %j", err || "SUCCESS", folders);
	if(folders.count !== 0) {
		session.add_to_trash(folders.data[0].id, function(err, trashresult) {
			console.log("add_to_trash: %s, %j", err || "SUCCESS", trashresult);
			assert.equal(err, null, "Folder could not be trashed");
			next();
		});
	} else process.nextTick(function() { next(); });
	var next = function() {
		session.create_folder_path("/AcdcTests", function(err, folder) {
			console.log("create_folder_path: %s, %j", err || "SUCCESS", folder);
			assert.equal(err, null, "Folder could not be created");
			session.upload( {name: "file-upload", kind: "FILE", parents: [ folder.id ] }, fs.createReadStream("file"), null, null, function(err, file) {
				console.log("upload: %s, %j", err || "SUCCESS", file);
				assert.equal(err, null, "File could not be uploaded");
				var fileStream = fs.createReadStream("file"), hash = crypto.createHash('md5');
				hash.setEncoding('hex');
				fileStream.pipe(hash);
				fileStream.on('end', function() {
					hash.end();
					var computedHash = hash.read();
					console.log("computed MD5: ", computedHash);
					assert.equal(file.contentProperties.md5, computedHash, "MD5 hash do not match");
					session.overwrite(file.id, fs.createReadStream("file2"), null, function(err, file) {
						console.log("overwrite: %s, %j", err || "SUCCESS", file);
						assert.equal(err, null, "File could not be overwritten");
						session.create_folder( { name: "SubFolder", kind: "FOLDER", parents: [ folder.id ] }, function(err, subfolder) {
							console.log("create_folder: %s, %j", err || "SUCCESS", subfolder);
							assert.equal(err, null, "SubFolder could not be created");
							session.move(file.id, folder.id, subfolder.id, function(err, movedfile) {
								console.log("move: %s, %j", err || "SUCCESS", movedfile);
								assert.equal(err, null, "File could not be moved");
								setTimeout( function() {
									session.list_children(subfolder.id, { sort: '["name"]' }, function(err, children) {
										console.log("list_children: %s, %j", err || "SUCCESS", children);
										assert.equal(err, null, "SubFolder content could not be listed");
									});
								}, 10000);
							});
						});
					});
				});
			});
		});
	};
});

1 || session.list({filters: 'kind:FILE'}, function(err, items) {
});

var util = require("util");
process.on('SIGINT', function() { console.log( util.inspect(process._getActiveHandles()) ); console.log(process._getActiveHandles()[0].constructor.name); console.log( util.inspect(process._getActiveRequests()) ); process.exit(); });
