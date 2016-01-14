var assert = require('assert');

var Api = require("./api");

var token = require("./token.json");

var session = new Api.Session(token);

var fs = require("fs");
var crypto = require("crypto");

var rsync = function(pathFrom, pathTo, cb) {
	async.parallel({
		listFrom: listFiles.bind(null, pathFrom),
		listTo: listFiles.bind(null, pathTo),
	},
	function(err, results) {
		if(err) return cb(err);
		var fromIt = 0, toIt = 0;
		var queue = async.queue(function(fun, cb) { fun(cb); });
		queue.on('drain', cb);
		for(; fromIt < results.listFrom.length ;) {
			if(results.listFrom[fromIt].name === results.listTo[toIt].name) {
				if(results.listFrom[fromIt].type !== results.listTo[toIt].type) {
					queue.push( function(cb) {
						deleteItem(results.listTo[toIt], function(err) {
							if(err) return cb(err);
							if(results.listFrom[fromIt].type === "FILE") {
								copyFile(results.listFrom[fromIt], pathTo, cb);
							} else {
								createFolder(pathTo, results.listFrom[fromIt].name, function(err, subfolder) {
									if(err) return cb(err);
									rsync(results.listFrom[fromIt], subfolder, cb);
								});
							}
						})
					);
				} else if(results.listFrom[fromIt].type === "FOLDER") {
					queue.push( function(cb) {
						rsync(results.listFrom[fromIt], subfolder, cb)
					});
				} else if(results.listFrom[fromIt].size === results.listFrom[toIt].size
				&& results.listFrom[fromIt].md5 === results.listFrom[toIt].md5) {
				} else {
					queue.push( function(cb) {
						overwriteFile(results.listFrom[fromIt], results.listFrom[toIt], cb);
					});
				}
				fromIt++; toIt++;
			} 
			else if(results.listFrom[fromIt].name < results.listTo[toIt].name) {
				if(results.listFrom[fromIt].type === "FILE") {
					queue.push( function(cb) {
						copyFile(results.listFrom[fromIt], pathTo, cb);
					});
				} else {
					queue.push( function(cb) {
						createFolder(pathTo, results.listFrom[fromIt].name, function(err, subfolder) {
							if(err) return cb(err);
							rsync(results.listFrom[fromIt], subfolder, cb);
						});
					});
				}
				fromIt++;
			}
			else if(results.listFrom[fromIt].name > results.listFrom[toIt].name) {
				toIt++;
			}
		}
	});
}

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
			session.upload( {name: "file-upload", kind: "FILE", parents: [ folder.id ] }, fs.createReadStream("file"), function(err, file) {
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
					session.overwrite(file.id, fs.createReadStream("file2"), function(err, file) {
						console.log("overwrite: %s, %j", err || "SUCCESS", file);
						assert.equal(err, null, "File could not be overwritten");
						session.create_folder( { name: "SubFolder", kind: "FOLDER", parents: [ folder.id ] }, function(err, subfolder) {
							console.log("create_folder: %s, %j", err || "SUCCESS", subfolder);
							assert.equal(err, null, "SubFolder could not be created");
							session.move(file.id, folder.id, subfolder.id, function(err, movedfile) {
								console.log("move: %s, %j", err || "SUCCESS", movedfile);
								assert.equal(err, null, "File could not be moved");
							});
						});
					});
				});
				
			});
		});
	};
});

var util = require("util");
process.on('SIGINT', function() { console.log( util.inspect(process._getActiveHandles()) ); console.log(process._getActiveHandles()[0].constructor.name); console.log( util.inspect(process._getActiveRequests()) ); process.exit(); });
