var assert = require('assert');

var Api = require("./api");

var token = require("./token.json");

var session = new Api.Session(token);

var fs = require("fs");
var crypto = require("crypto");
var async = require("async");
var path = require("path");
var debug = require("debug")("rsync")

var FsPath = function(path) {
	this.path = path;
}

var FsPath = function(path) {
	this.path = path;
}

var AcPath = function(session, id) {
	this.id = id;
	this.session = session;
}

var listFiles = function(path, cb) {

	if(path instanceof FsPath) {
		fs.readdir(path.path, function(err, itemnames) {
			if(err) return cb(err);
			itemnames.sort();
			var files = new Array(itemnames.length);
			for(var i = 0 ; i < itemnames.length ; ++i) {
				files[i] = {};
			}
			async.forEachOf(itemnames, function(itemname, index, cb) {
				fs.open(path.path + "/" + itemname, "r", function(err, fd) {
					if(err) return cb(err);
					fs.fstat(fd, function(err, stats) {
						if(err) return cb(err);
						files[index].size = stats.size;
						files[index].name = itemname;
						files[index].isDirectory = stats.isDirectory();
						if(!stats.isDirectory()) {
							var fileStream = fs.createReadStream("", { fd: fd });
							var hash = crypto.createHash('md5');	
							hash.setEncoding('hex');
							fileStream.pipe(hash);
							fileStream.on('end', function() {
								hash.end();
								files[index].md5 = hash.read();
								cb(null);
							});
						} else cb(null);
					});
				});

			}, function(err) {
				cb(err, files);
			});

		});
	} else if(path instanceof AcPath) {
		path.session.list_children(path.id, null, function(err, items) {
		});
	}
	
}


var copyFile = function(pathFrom, name, pathTo, cb) {
	debug("copyFile %j %s %j", pathFrom, name, pathTo);
	if(pathFrom instanceof FsPath && pathTo instanceof FsPath) {
		var cbCalled = false;

		var rd = fs.createReadStream(path.join(pathFrom.path, name));
		rd.on("error", function(err) {
				done(err);
		});
		var wr = fs.createWriteStream(path.join(pathTo.path, name));
		wr.on("error", function(err) {
				done(err);
		});
		wr.on("close", function(ex) {
				done();
		});
		rd.pipe(wr);

		function done(err) {
			if (!cbCalled) {
				cb(err);
				cbCalled = true;
			}
		}		
	} 
}

var overwriteFile = function(pathFrom, name, pathTo, cb) {
	debug("overwriteFile %j %s %j", pathFrom, name, pathTo);
	if(pathFrom instanceof FsPath && pathTo instanceof FsPath) {
		copyFile(pathFrom, name, pathTo, cb);
	} 
}

var deleteItem = function(basePath, name, cb) {
	debug("deleteItem %j", basePath);
	if(basePath instanceof FsPath) {
		fs.unlink(path.join(basePath.path, name), cb);
	} 
}

var createFolder = function(basePath, name, cb) {
	debug("createFolder %j", basePath);
	if(basePath instanceof FsPath) {
		var newPath = path.join(basePath.path, name);
		fs.mkdir(newPath, function(err) {
			if(err) return cb(err);
			return cb(err, new FsPath(newPath));
		});
	}
}

var pathJoin = function(basePath, name, cb) {
	debug("pathJoin %j, %s", basePath, name);
	if(basePath instanceof FsPath) {
		process.nextTick(function() {
			cb(null, new FsPath(path.join(basePath.path, name)));
		});
	}
}

/*listFiles(new FsPath("."), function(err, files) {
	console.log("%s, %j", err, files);
});*/

var rsync = function(options, pathFrom, pathTo, cb) {
	debug("rsync %j", pathFrom, pathTo);
	async.parallel({
		listFrom: listFiles.bind(null, pathFrom),
		listTo: listFiles.bind(null, pathTo),
	},
	function(err, results) {
		if(err) return cb(err);
		var fromIt = 0, toIt = 0;
		var queue = async.queue(function(fun, cb) { fun(cb); });
		queue.drain = cb;
		for(; fromIt < results.listFrom.length || toIt < results.listTo.length ;) {
			var series = [];

			if(	(
					fromIt < results.listFrom.length && toIt < results.listTo.length &&
					results.listFrom[fromIt].name === results.listTo[toIt].name && // same name
					(
						results.listFrom[fromIt].isDirectory !== results.listTo[toIt].isDirectory || // different type, or
						(
							!results.listFrom[fromIt].isDirectory && ( // (for files only)
								results.listFrom[fromIt].size !== results.listTo[toIt].size || // different size, or
								results.listFrom[fromIt].md5 !== results.listTo[toIt].md5 // different hash
							)
						)
					)
				)
			) { // conflicting name
				// delete/archive
				series.push(function(toIt, cb) {
					deleteItem(pathTo, results.listTo[toIt].name, cb);
				}.bind(null, toIt));
				toIt++;
			} else if ( (
					fromIt < results.listFrom.length && toIt < results.listTo.length && // extraneous in To
					results.listFrom[fromIt].name > results.listTo[toIt].name
				) || (
					fromIt >= results.listFrom.length // extraneous in To
				)
			) {
				// delete/archive or do nothing - no dependencies (direct queue push)
				if (options.deleteExtraneous) {
					queue.push(function(toIt, cb) {
						deleteItem(pathTo, results.listTo[toIt].name, cb);
					}.bind(null, toIt));
				}
				toIt++;
			}

			if(	fromIt < results.listFrom.length && toIt < results.listTo.length &&
				results.listFrom[fromIt].name === results.listTo[toIt].name && // same name
				(
					results.listFrom[fromIt].isDirectory === results.listTo[toIt].isDirectory && // same type, and
					(
						results.listFrom[fromIt].isDirectory || ( // (for files only)
							results.listFrom[fromIt].size === results.listTo[toIt].size && // same size, and
							results.listFrom[fromIt].md5 === results.listTo[toIt].md5 // same hash
						)
					)
				)
			) {	// rsync folder
				if(results.listFrom[fromIt].isDirectory) {
					queue.push(function(fromIt, toIt, cb) {
						async.parallel({
							subPathFrom: pathJoin.bind(null, pathFrom, results.listFrom[fromIt].name),
							subPathTo: pathJoin.bind(null, pathTo, results.listTo[toIt].name)
						}, function(err, results) {
							if(err) return cb(err);
							rsync(options, results.subPathFrom, results.subPathTo, cb);
						});
					}.bind(null, fromIt, toIt));
				}
				// do nothing to files
				fromIt++; toIt++;
			} else if(fromIt < results.listFrom.length && 
					(toIt >= results.listTo.length ||
					results.listFrom[fromIt].name < results.listTo[toIt].name)
				) {
				// copy & rsync
				series.push(function(fromIt, cb) {
					if(!results.listFrom[fromIt].isDirectory) {
						copyFile(pathFrom, results.listFrom[fromIt].name, pathTo, cb);
					} else {
						async.parallel({
							subPathFrom: pathJoin.bind(null, pathFrom, results.listFrom[fromIt].name),
							subPathTo: createFolder.bind(null, pathTo, results.listFrom[fromIt].name)
						}, function(err, results) {
							if(err) return cb(err);
							rsync(options, results.subPathFrom, results.subPathTo, cb);
						});
					}
				}.bind(null, fromIt));
				queue.push(async.series.bind(null, series));
				fromIt++;
			}

		}
	});
}

rsync({}, new FsPath("a"), new FsPath("b"), function(err) {
	console.log("rsync: %s", err || "SUCCESS");
});

var util = require("util");
process.on('SIGINT', function() { console.log( util.inspect(process._getActiveHandles()) ); console.log(process._getActiveHandles()[0].constructor.name); console.log( util.inspect(process._getActiveRequests()) ); process.exit(); });
