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

var AcPath = function(path) {
	this.path = path;
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
			console.log("%d, %j", itemnames.length, files[0]);
			async.forEachOf(itemnames, function(itemname, index, cb) {
				console.log("Index = %d", index);
				fs.open(path.path + "/" + itemname, "r", function(err, fd) {
					if(err) return cb(err);
					fs.fstat(fd, function(err, stats) {
						if(err) return cb(err);
						console.log("%d", index);
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

var deleteItem = function(path, name, cb) {
	debug("delteItem %j", path);
	if(path instanceof FsPath) {
		fs.unlink(path.join(path, name), cb);
	} 
}

var createFolder = function(path, cb) {
	debug("createFolder %j", path);
	if(path instanceof FsPath) {
		fs.mkdir(path.path, cb);
	}
}

/*listFiles(new FsPath("."), function(err, files) {
	console.log("%s, %j", err, files);
});*/

var rsync = function(pathFrom, pathTo, cb) {
	async.parallel({
		listFrom: listFiles.bind(null, pathFrom),
		listTo: listFiles.bind(null, pathTo),
	},
	function(err, results) {
		if(err) return cb(err);
		console.log("%j", results);
		var fromIt = 0, toIt = 0;
		var queue = async.queue(function(fun, cb) { fun(cb); });
		queue.drain = cb;
		for(; fromIt < results.listFrom.length ;) {
			(function(curFromIt, curToIt) {
				if(toIt >= results.listTo.length || results.listFrom[curFromIt].name < results.listTo[curToIt].name) {
					queue.push(function(cb) {
						if(!results.listFrom[curFromIt].isDirectory) {
							copyFile(pathFrom, results.listFrom[curFromIt].name, pathTo, cb);
						} else {
							createFolder(pathTo, results.listFrom[curFromIt].name, function(err, subfolder) {
								if(err) return cb(err);
								rsync(results.listFrom[curFromIt], subfolder, cb);
							});
						}
					});
					fromIt++;
				} else if(results.listFrom[curFromIt].name === results.listTo[curToIt].name) {
					if(results.listFrom[curFromIt].isDirectory !== results.listTo[curToIt].isDirectory) {
						queue.push( function(cb) {
							deleteItem(pathTo, results.listTo[curToIt], function(err) {
								if(err) return cb(err);
								if(!results.listFrom[curFromIt].isDirectory) {
									copyFile(pathFrom, results.listFrom[curFromIt].name, pathTo, cb);
								} else {
									createFolder(pathTo, results.listFrom[curFromIt].name, function(err, subfolder) {
										if(err) return cb(err);
										rsync(results.listFrom[curFromIt], subfolder, cb);
									});
								}
							})
						});
					} else if(results.listFrom[curFromIt].isDirectory) {
						queue.push( function(cb) {
							rsync(results.listFrom[curFromIt], subfolder, cb)
						});
					} else if(results.listFrom[curFromIt].size === results.listTo[curToIt].size
					&& results.listFrom[curFromIt].md5 === results.listTo[curToIt].md5) {
					} else {
						queue.push( function(cb) {
							overwriteFile(pathFrom, results.listFrom[curFromIt].name, pathTo, cb);
						});
					}
					fromIt++; toIt++;
				} 
				else if(results.listFrom[curFromIt].name > results.listTo[curToIt].name) {
					toIt++;
				}
			})(fromIt, toIt);
		}
	});
}

rsync(new FsPath("a"), new FsPath("b"), function(err) {
	console.log("rsync: %s", err);
});

var util = require("util");
process.on('SIGINT', function() { console.log( util.inspect(process._getActiveHandles()) ); console.log(process._getActiveHandles()[0].constructor.name); console.log( util.inspect(process._getActiveRequests()) ); process.exit(); });
