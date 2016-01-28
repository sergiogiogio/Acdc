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

var rsync = function(options, cursorFrom, cursorTo, lazyCursorArchive, cb) {
	debug("rsync %j %j", cursorFrom, cursorTo);
	async.parallel({
		listFrom: cursorFrom.listFiles.bind(cursorFrom),
		listTo: cursorTo.listFiles.bind(cursorTo),
	},
	function(err, results) {
		if(err) return cb(err);
		var fromIt = 0, toIt = 0;
		var parallel = [];
		for(; fromIt < results.listFrom.length || toIt < results.listTo.length ;) {
			var series = [];

		var loop = function(fromIt, isDirectory, toIt, cb) {
			var savFromIt = fromIt;
			if(!isDirectory && fromIt < results.listFrom.length)
				return cursorFrom.isDirectory(results.listFrom[fromIt], function(err, isDirectory) {
						if(err) return cb(err);
						loop(fromIt, isDirectory, toIt, cb);
					});

			var opCopy = function(cb) {
				var item = results.listFrom[fromIt];
				if(isDirectory) {
					copyFile(cursorFrom, item, cursorTo, cb);
				} else {
					async.parallel({
						from: cursorFrom.moveTo.bind(cursorFrom, item),
						to: cursorTo.createFolder.bind(cursorTo, item.name)
					}, function(err, subResults) {
						if(err) return cb(err);
						rsync(options, subResults.from, subResults.to, new LazyCursor(lazyCursorArchive, item.name), cb);
					});
				}
			}
			var opDelete = function(cb) {
				deleteItem(cursorTo, results.listTo[toIt], lazyCursorArchive, cb);
			} 
			var opReplace = async.series([
				opDelete,
				opCopy]);

			var opRsync = function(cb) {
				async.parallel({
					subCursorFrom: cursorFrom.moveTo.bind(cursorFrom, results.listFrom[fromIt]),
					subCursorTo: cursorTo.moveTo.bind(cursorTo, results.listTo[toIt])
				}, function(err, subResults) {
					if(err) return cb(err);
					rsync(options, subResults.subCursorFrom, subResults.subCursorTo, new LazyCursor(lazyCursorArchive, results.listFrom[fromIt].name), cb);
				});
			} 

			if(
				(fromIt < results.listFrom.length && toIt < results.listTo.length && results.listFrom[fromIt].name < results.listTo[toIt].name) ||
				(fromIt < results.listFrom.length && toIt === results.listTo.length)
			) {
				queue.push(opCopy);
				fromIt++;
			} else if(
				(fromIt < results.listFrom.length && toIt < results.listTo.length && results.listFrom[fromIt].name > results.listTo[toIt].name) ||
				(fromIt === results.listFrom.length && toIt < results.listTo.length)
			) {
				// delete/archive or do nothing - no dependencies (direct queue push)
				if (options.deleteExtraneous) {
					queue.push(opDelete);
				}
				toIt++;
			} else { // same name
				cursorTo.isDirectory(function(err, isDirectoryTo) {
					if(err) return cb(err);
					if(isDirectory !== isDirectoryTo) {
						// replace
						queue.push(opReplace);		
					} else if(isDirectory) {
						queue.push(opRsync);		
					} else {
						async.parallel({
							from: cursorFrom.getLength.bind(cursorFrom, results.listFrom[fromIt]),
							to: cursorTo.getLength.bind(cursorTo, results.listTo[toIt])
						}, function(err, getLengthResults) {
							if(err) return cb(err);
							if(getLengthResults.from !== getLengthResults.to) {
								// replace
								queue.push(opReplace);		
							} else {
								async.parallel({
									from: cursorFrom.getMD5.bind(cursorFrom, results.listFrom[fromIt]),
									to: cursorTo.getMD5.bind(cursorTo, results.listTo[toIt])
								}, function(err, getMD5Results) {
									if(err) return cb(err);
									if(getMD5Results.from !== getMD5Results.to) {
										// replace
										queue.push(opReplace);		
									}
									
								});
							}
						});
					}
					}
				});
				fromIt++; toIt++;
			}
			if(fromIt < results.listFrom.length || toIt < results.listTo.length) {
				queue.push(loop.bind(null, fromIt, (savFromIt == fromIt) ? isDirectory : null, toIt));
			}
			cb(null);
		};
		
		if(fromIt < results.listFrom.length || toIt < results.listTo.length) {
			queue.push(loop.bind(null, fromIt, null, toIt));
		}

		
				
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
					deleteItem(cursorTo, results.listTo[toIt], lazyCursorArchive, cb);
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
					parallel.push(function(toIt, cb) {
						deleteItem(cursorTo, results.listTo[toIt], lazyCursorArchive, cb);
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
					parallel.push(function(fromIt, toIt, cb) {
						async.parallel({
							subCursorFrom: cursorFrom.moveTo.bind(cursorFrom, results.listFrom[fromIt]),
							subCursorTo: cursorTo.moveTo.bind(cursorTo, results.listTo[toIt])
						}, function(err, subResults) {
							if(err) return cb(err);
							rsync(options, subResults.subCursorFrom, subResults.subCursorTo, new LazyCursor(lazyCursorArchive, results.listFrom[fromIt].name), cb);
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
						copyFile(cursorFrom, results.listFrom[fromIt], cursorTo, cb);
					} else {
						async.parallel({
							subCursorFrom: cursorFrom.moveTo.bind(cursorFrom, results.listFrom[fromIt]),
							subCursorTo: cursorTo.createFolder.bind(cursorTo, results.listFrom[fromIt].name)
						}, function(err, subResults) {
							if(err) return cb(err);
							rsync(options, subResults.subCursorFrom, subResults.subCursorTo, new LazyCursor(lazyCursorArchive, results.listFrom[fromIt].name), cb);
						});
					}
				}.bind(null, fromIt));
				parallel.push(async.series.bind(null, series));
				fromIt++;
			}

		}
		async.parallel(parallel, cb);
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

var util = require("util");
process.on('SIGINT', function() { console.log( util.inspect(process._getActiveHandles()) ); console.log(process._getActiveHandles()[0].constructor.name); console.log( util.inspect(process._getActiveRequests()) ); process.exit(); });
