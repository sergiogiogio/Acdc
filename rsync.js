'use strict'

var assert = require('assert');

var Api = require("./api");

var token = require("./token.json");

var session = new Api.Session(token);

var fs = require("fs");
var crypto = require("crypto");
var async = require("async");
var path = require("path");
var debug = require("debug")("rsync")
var mstream = require("stream");
var util = require("util");

var FsCursor = function(path) {
	this.currentPath = path;
}

FsCursor.prototype.listFiles = function(cb) {
	debug("FsCursor.listFiles");
	var self = this;
	fs.readdir(self.currentPath, function(err, itemnames) {
		if(err) return cb(err);
		itemnames.sort();
		var files = new Array(itemnames.length);
		for(var i = 0 ; i < itemnames.length ; ++i) {
			files[i] = {};
		}
		async.forEachOf(itemnames, function(itemname, index, cb) {
			fs.open(path.join(self.currentPath, itemname), "r", function(err, fd) {
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
};

FsCursor.prototype.createFile = function(name, stream, size, cb) {
	debug("FsCursor.createFile %s, %d", name, size);
	var self = this;
	var wstream = fs.createWriteStream(path.join(self.currentPath, name));
	wstream.on("finish", function() {
		cb(null);
	});
	wstream.on("error", function(err) {
		cb(err);
	});
	stream.pipe(wstream);
}


FsCursor.prototype.isDirectory = function(item, cb) {
	debug("FsCursor.isDirectory %j", item);
	var self = this;
	fs.stat(path.join(self.currentPath, item.name), function(err, stats) {
		if(err) return cb(err);
		return cb(null, stats.isDirectory());
	});
}

FsCursor.prototype.getLength = function(item, cb) {
	debug("FsCursor.getLength %s", item.name);
	var self = this;
	fs.stat(path.join(self.currentPath, item.name), function(err, stats) {
		if(err) return cb(err);
		return cb(null, stats.size);
	});
}

FsCursor.prototype.getMD5 = function(item, cb) {
	debug("FsCursor.getMD5 %s", item.name);
	var self = this;
	var fileStream = fs.createReadStream(path.join(self.currentPath, item.name));
	var hash = crypto.createHash('md5');	
	hash.setEncoding('hex');
	fileStream.pipe(hash);
	fileStream.on('end', function() {
		hash.end();
		cb(null, hash.read());
	});
}

FsCursor.prototype.readFile = function(item, cb) {
	debug("FsCursor.readFile %s", item.name);
	var self = this;
	process.nextTick( function() {
		var stream = fs.createReadStream(path.join(self.currentPath, item.name));
		cb(null, stream);
	});
}

FsCursor.prototype.deleteItem = function(item, cb) {
	debug("FsCursor.deleteItem %s", item.name);
	var self = this;
	fs.unlink(path.join(self.currentPath, item.name), cb);
}


FsCursor.prototype.createFolder = function(name, cb) {
	debug("FsCursor.createFolder %s", name);
	var self = this;
	var newPath = path.join(self.currentPath, name);
	fs.mkdir(newPath, function(err) {
		if(err) return cb(err);
		return cb(err, new FsCursor(newPath));
	});
}

FsCursor.prototype.moveTo = function(item, cb) {
	debug("FsCursor.moveTo %s", item.name);
	var self = this;
	process.nextTick(function() {
		cb(null, new FsCursor(path.join(self.currentPath, item.name)));
	});
}

FsCursor.prototype.init = function(str, cb) {
	debug("FsCursor.init %s", str);
	var self = this;
	process.nextTick( function() {
		self.currentPath = str;
		cb(null);
	});
}


var AcdCursor = function(session, nodeid) {
	this.session = session;
	this.nodeid = nodeid;
}

AcdCursor.prototype._listFiles = function(startToken, files, cb) {
	var self = this;
	var list_children_options = { sort: '["name ASC"]' };
	if(startToken) list_children_options.startToken = startToken;
	self.session.list_children(self.nodeid, list_children_options, function(err, items) {
		if(err) return cb(err);
		items.data.forEach(function(child, index) {
			var item = { name: child.name, nodeid: child.id, isDirectory: (child.kind === "FOLDER") };
			if(child.kind !== "FOLDER") {
				item.size = child.contentProperties.size;
				item.md5 =  child.contentProperties.md5;
			}
			files.push(item);
		});
		if(items.nextToken) {
			return self.listFiles(startToken, files, cb);
		} else cb(null, files);

	});
};

AcdCursor.prototype.listFiles = function(cb) {
	debug("AcdCursor.listFiles");
	var self = this;
	return self._listFiles(null, [], cb);
};


AcdCursor.prototype.createFile = function(name, stream, size, cb) {
	debug("AcdCursor.createFile %s", name);
	var self = this;
	self.session.upload({name: name, kind: "FILE", parents: [ self.nodeid ] }, stream, size, { suppress: "deduplication" }, cb);
}

AcdCursor.prototype.readFile = function(item, cb) {
	debug("AcdCursor.readFile %s", item.name);
	var self = this;
	self.session.download(item.nodeid, function(err, stream) {
		if(err) return cb(err);
		return cb(null, stream);
	});
}

AcdCursor.prototype.deleteItem = function(item, cb) {
	debug("AcdCursor.deleteItem %s", item.name);
	var self = this;
	self.session.add_to_trash(item.nodeid, function(err, result) {
		if(err) return cb(err);
		return cb(null);
	});
}


AcdCursor.prototype.createFolder = function(name, cb) {
	debug("AcdCursor.createFolder %s", name);
	var self = this;
	self.session.create_folder({kind: "FOLDER", name: name, parents: [self.nodeid] }, function(err, folder) {
		if(err) return cb(err);
		return cb(err, new AcdCursor(self.session, folder.id));
	});
}

AcdCursor.prototype.moveTo = function(item, cb) {
	debug("AcdCursor.moveTo %s", item);
	var self = this;
	process.nextTick(function() {
		cb(null, new AcdCursor(self.session, item.nodeid));
	});
}

AcdCursor.prototype.init = function(str, cb) {
	debug("AcdCursor.init %s", str);
	var self = this;
	self.session.resolve_path(str, function(err, result) {
		if(err) return cb(err);
		if(result.count === 0) return cb(new Error("ENOENT"));
		self.nodeid = result.data[0].id;
		cb(null);
	});
}

var copyFile = function(cursorFrom, item, cursorTo, cb) {
	debug("copyFile %j %s %j", cursorFrom, item.name, cursorTo);
	cursorFrom.readFile(item, function(err, stream) {
		var cbCalled = false;
		stream.on("error", function(err) {
			done(err);
		});
		cursorTo.createFile(item.name, stream, item.size, function(err) {
			done(err);
		});
		function done(err) {
			if (!cbCalled) {
				console.log("calling callback %s", err);
				cb(err);
				cbCalled = true;
			}
		}
	});
}

var deleteItem = function(cursor, item, lazyCursor, cb) {
	debug("deleteItem %j %s %j", cursor, item.name, lazyCursor);
	lazyCursor.get(function(err, archiveCursor) {
		if(err) return cb(err);
		copyFile(cursor, item, archiveCursor, function(err) {
			if(err) return cb(err);
			cursor.deleteItem(item, cb);
		});
	});
}

var LazyCursor = function(cursor, name) {
	if(name) {
		this.lazyParentCursor = cursor;
		this.name = name;
	} else {
		this.cursor = cursor;
	}
}

LazyCursor.prototype.get = function(cb) {
	var self = this;
	if(self.cursor) {
		return process.nextTick (function() {
			cb(null, self.cursor);
		});
	} else {
		self.lazyParentCursor.get(function(err, parentCursor) {
			if(err) return cb(err);
			parentCursor.createFolder(self.name, function(err, cursor) {
				if(err) return cb(err);
				self.cursor = cursor;
				self.get(cb);
			});
			
		});
	}
}

/*listFiles(new FsPath("."), function(err, files) {
	console.log("%s, %j", err, files);
});*/


var queue = async.queue(function(fun, cb) { console.log("start queue fun"); fun(cb); }, 1);

var rsync = function(options, cursorFrom, cursorTo, lazyCursorArchive, maincb) {

	var errQueue = null;

	queue.drain = function() {
		console.log('all items have been processed');
	}
	var openTasks = 0;
	var pushTask = function(task) {
		openTasks++;
		console.log("openTasks: %j %j %d", cursorFrom, cursorTo, openTasks);
		queue.push(function(cb) {
			if(errQueue) return cb(err);
			task(function(err) {
				openTasks--;
				console.log("closeTasks: %j %j %d -> %d", cursorFrom, cursorTo, openTasks, queue.running());
				errQueue = err;
				console.log("error: %s", errQueue);
				cb(err);
				if(err) return maincb(err);
				if(!openTasks) maincb();
			});
		});
		console.log("task pushed!");
	}

	pushTask (
		rsync_core.bind(null, options, cursorFrom, cursorTo, lazyCursorArchive, pushTask)
	);
};

var rsync_core = function(options, cursorFrom, cursorTo, lazyCursorArchive, pushTask, cb) {
	debug("rsync %j %j", cursorFrom, cursorTo);
	async.parallel({
		listFrom: cursorFrom.listFiles.bind(cursorFrom),
		listTo: cursorTo.listFiles.bind(cursorTo),
	},
	function(err, results) {
		if(err) return cb(err);
		
		var loop = function(fromIt, isDirectory, toIt, cb) {
			if(fromIt == results.listFrom.length && toIt == results.listTo.length) {
				console.log("nothing to do..." );
				return process.nextTick(cb.bind(null,null));
			}
			var nextFromIt = fromIt, nextToIt = toIt;
			if(isDirectory === null && fromIt < results.listFrom.length) {
				console.log("request isDirectory" );
				return cursorFrom.isDirectory(results.listFrom[fromIt], function(err, isDirectory) {
						if(err) return cb(err);
						return loop(fromIt, isDirectory, toIt, cb);
					});
			}
			console.log("start loop" );
			var opCopy = function(cb) {
				var item = results.listFrom[fromIt];
				if(!isDirectory) {
					copyFile(cursorFrom, item, cursorTo, cb);
				} else {
					async.parallel({
						from: cursorFrom.moveTo.bind(cursorFrom, item),
						to: cursorTo.createFolder.bind(cursorTo, item.name)
					}, function(err, subResults) {
						if(err) return cb(err);
						rsync_core(options, subResults.from, subResults.to, new LazyCursor(lazyCursorArchive, item.name), pushTask, cb);
					});
				}
			}
			var opDelete = function(cb) {
				deleteItem(cursorTo, results.listTo[toIt], lazyCursorArchive, cb);
			} 
			var opReplace = async.seq(opDelete, opCopy);

			var opRsync = function(cb) {
				async.parallel({
					subCursorFrom: cursorFrom.moveTo.bind(cursorFrom, results.listFrom[fromIt]),
					subCursorTo: cursorTo.moveTo.bind(cursorTo, results.listTo[toIt])
				}, function(err, subResults) {
					if(err) return cb(err);
					console.log("calling rsync...");
					rsync_core(options, subResults.subCursorFrom, subResults.subCursorTo, new LazyCursor(lazyCursorArchive, results.listFrom[fromIt].name), pushTask, cb);
				});
			} 

			if(
				(fromIt < results.listFrom.length && toIt < results.listTo.length && results.listFrom[fromIt].name < results.listTo[toIt].name) ||
				(fromIt < results.listFrom.length && toIt === results.listTo.length)
			) {
				opCopy (cb);
				nextFromIt++;
			} else if(
				(fromIt < results.listFrom.length && toIt < results.listTo.length && results.listFrom[fromIt].name > results.listTo[toIt].name) ||
				(fromIt === results.listFrom.length && toIt < results.listTo.length)
			) {
				// delete/archive or do nothing - no dependencies (direct queue push)
				if (options.deleteExtraneous) {
					opDelete (cb);
				} else {
					process.nextTick(function() {
						cb(null);
					});
				}
				nextToIt++;
			} else { // same name
				cursorTo.isDirectory(results.listTo[toIt], function(err, isDirectoryTo) {
					if(err) return cb(err);
					console.log("isDirectory: %d %d" , isDirectory, isDirectoryTo);
					if(isDirectory !== isDirectoryTo) {
						// replace
						console.log("we replace");
						opReplace(cb);		
					} else if(isDirectory) {
						console.log("we sync");
						opRsync(cb);
					} else {
						async.parallel({
							from: cursorFrom.getLength.bind(cursorFrom, results.listFrom[fromIt]),
							to: cursorTo.getLength.bind(cursorTo, results.listTo[toIt])
						}, function(err, getLengthResults) {
							if(err) return cb(err);
							if(getLengthResults.from !== getLengthResults.to) {
								// replace
								console.log("we replace");
								opReplace(cb);		
							} else {
								async.parallel({
									from: cursorFrom.getMD5.bind(cursorFrom, results.listFrom[fromIt]),
									to: cursorTo.getMD5.bind(cursorTo, results.listTo[toIt])
								}, function(err, getMD5Results) {
									if(err) return cb(err);
									if(getMD5Results.from !== getMD5Results.to) {
										// replace
										console.log("we replace");
										opReplace(cb);		
									} else {
										console.log("we do nothing");
										cb(null);
									}
								});
							}
						});
					}
				});
				nextFromIt++; nextToIt++;
			}
			pushTask( loop.bind(null, nextFromIt, (nextFromIt == fromIt) ? isDirectory : null, nextToIt) );
		};
		loop(0, null, 0, cb);
		
	});
}

var fromCursor = new FsCursor(), fromLocation = "a";
//var fromCursor = new AcdCursor(session), fromLocation = "/SyncTests";


var toCursor = new FsCursor(), toLocation = "b";
//var toCursor = new AcdCursor(session), toLocation = "/SyncTests2";


var archiveCursor = new FsCursor(), archiveLocation = "archive";
//var archiveCursor = new AcdCursor(session), archiveLocation = "/SyncTests2";

(function(cb) {
	async.parallel([
		fromCursor.init.bind(fromCursor, fromLocation),
		toCursor.init.bind(toCursor, toLocation),
		archiveCursor.init.bind(archiveCursor, archiveLocation)
	], function(err, results) {
		if(err) return cb(err);
		rsync({}, fromCursor, toCursor, new LazyCursor(archiveCursor), cb);
	});
})(function (err){
	console.log("rsync: %s", err || "SUCCESS");
});

process.on('beforeExit', function() {
	console.log("beforeExit: queue %d %d %d", queue.started, queue.running(), queue.length());
});

process.on('exit', function() {
	console.log("exit: queue %d %d %d", queue.started, queue.running(), queue.length());
});
var util = require("util");
process.on('SIGINT', function() { console.log( util.inspect(process._getActiveHandles()) ); console.log(process._getActiveHandles()[0].constructor.name); console.log( util.inspect(process._getActiveRequests()) ); process.exit(); });
