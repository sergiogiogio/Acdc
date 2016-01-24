'use strict';

var https = require('https');
var http = require('http');
var querystring = require('querystring');
var util = require('util');
var EventEmitter = require('events');
var url = require('url');
var path = require('path');
var FormData = require('form-data');
var mstream = require('stream');
var debug = require('debug')('acdc-api');
var debugTransport = require('debug')('acdc-api:transport');

var Session = function(token) {
	this.token = token;

} 

util.inherits(Session, EventEmitter);

var call_cb = function(fname, cb, err, result) {
	debug("%s callback(%s, %j)", fname, err || "SUCCESS", result);
	cb(err, result);
}

Session.prototype.read_response = function(res, requestId, transform, cb) {
	var result = "";
	res.setEncoding('utf8');
	res.on('data', function (chunk) {
		debugTransport("Response chunk(%d): %s", requestId, chunk);
		result += chunk;
	});
	res.on('end', function() {
		var tresult;
		try {	
			tresult = transform(result);
		} catch(err) {
			return cb(err);
		}
		cb(null, tresult);
	});
}

Session.prototype.refresh_endpoint = function(cb_res) {
	var self = this;
	if(self.endpoint) return process.nextTick(cb_res, null, self.endpoint);
	debug("no endpoint");
	self.account_endpoint( function(err, data) {
		if(err) return cb_res(err);
		self.endpoint = data;
		self.emit("newEndpoint", self.endpoint);
		cb_res(null, self.endpoint);
	});
}

var LogStream = function(requestId) {
	this.requestId = requestId;
	LogStream.super_.call(this);
}
util.inherits(LogStream, mstream.PassThrough);
LogStream.prototype._transform = function(chunk, encoding, callback) {
	debugTransport("Request chunk(%d): %s", this.requestId, chunk);
	return LogStream.super_.prototype._transform.call(this, chunk, encoding, callback);
};

var sRequestId = 0;
Session.prototype.request = function(cb_pre, cb_opt, cb_req, cb_res) {
	var self = this;
	if(cb_pre) return cb_pre( function(err, result) {
			if(err) return cb_res(err);
			self.request(null, cb_opt, cb_req, cb_res);
		});
	var req_options = {
		headers: {
			"Authorization": "Bearer " + self.token.access_token
		}
	};
	cb_opt(req_options);
	var module = (req_options.host === "localhost") ? http : https;
	var requestId = sRequestId++;
	var req = module.request(req_options, function(res) {
		debugTransport("Response(%d): %d, Headers: %j", requestId, res.statusCode, res.headers);
		switch(res.statusCode) {
			case 401: {
				var data = querystring.stringify({
					refresh_token: self.token.refresh_token
				});
				var tokenRequestId = sRequestId++;
				var token_request_opt = {
					host: "acdc-1163.appspot.com",
					path: "/",
					method: "POST",
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'Content-Length': Buffer.byteLength(data)
					}
				};
				var req = https.request(token_request_opt, function(res) {
					self.read_response(res, tokenRequestId, JSON.parse, function(err, token) {
						self.token = token;
						self.emit("newToken", self.token);
						self.request(cb_pre, cb_opt, cb_req, cb_res);
					});
				});
				req.write(data);
				req.end();
				debugTransport("Request(%d): %j", tokenRequestId, token_request_opt);
			}
			break;
			case 200:
			case 201:
				cb_res(null, res, requestId);
			break;
			default:
				cb_res(new Error(res.statusCode), res, requestId);
			break;
		}
	});
	debugTransport("Request(%d): %j", requestId, req_options);
	var logstream = new LogStream(requestId);
	logstream.pipe(req);
	cb_req(logstream);
};

Session.prototype.account_endpoint = function(cb) {
	var fname = "account_endpoint";
	debug(fname);
	var self = this;
	self.request(null,
		function(opt) {
			opt.host = "drive.amazonaws.com";
			opt.path = "/drive/v1/account/endpoint";
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

var serialize = function(obj) {
	var str = [];
	for(var p in obj)
		if (obj.hasOwnProperty(p)) {
			str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
		}
	return str.join("&");
}

Session.prototype.list = function(options, cb) {
	var fname = "list";
	debug(fname + "(%j)", options);
	var self = this;
	self.request(self.refresh_endpoint.bind(self),
		function(opt) {
			opt.host = url.parse(self.endpoint.metadataUrl).host;
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes" + (options ? "?" + serialize(options) : "");
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};


Session.prototype.list_children = function(parentid, options, cb) {
	var fname = "list_children";
	debug(fname + "(%s, %j)", parentid, options);
	var self = this;
	self.request(self.refresh_endpoint.bind(self),
		function(opt) {
			opt.host = url.parse(self.endpoint.metadataUrl).host
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes/" + parentid  + "/children" + (options ? "?" + serialize(options) : "");
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

var AcdcError = function(code, message) {
	this.code = code;
	this.message = message;
}


Session.prototype.resolve_path = function(node_path, cb) {
	var fname = "resolve_path";
	debug(fname + "(%s)", node_path);
	var self = this;
	var parse = path.parse(node_path);
	switch(parse.base) {
		case "":
		self.request(self.refresh_endpoint.bind(self),
			function(opt) {
				opt.host = url.parse(self.endpoint.metadataUrl).host;
				opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes?filters=" + encodeURIComponent("kind:FOLDER AND isRoot:true");
				opt.method = "GET";
			}, function(req) {
				req.end();
			}, function(err, res, requestId) {
				if(err) return call_cb(fname, cb, err);
				self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
			}
		);
		break;

		default:
		self.resolve_path(parse.dir, function(err, result) {
			if(err) return call_cb(fname, cb, err);
			if(result.count === 0) return call_cb(fname, err, result);
			self.request(self.refresh_endpoint.bind(self),
				function(opt) {
					opt.host = url.parse(self.endpoint.metadataUrl).host;
					opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes/" + result.data[0].id + "/children?filters=name:" + encodeURIComponent(parse.name);
					opt.method = "GET"
				}, function(req) {
					req.end();
				}, function(err, res, requestId) {
					if(err) return call_cb(fname, cb, err);
					self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
				}
			);
		});
		break;
	}
	
}

Session.prototype.create_folder_path = function(node_path, cb) {
	var fname = "create_folder_path";
	debug(fname + "(%s)", node_path);
	var self = this;
	var parse = path.parse(node_path);
	switch(parse.base) {
		case "":
		self.request(self.refresh_endpoint.bind(self),
			function(opt) {
				opt.host = url.parse(self.endpoint.metadataUrl).host;
				opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes?filters=" + encodeURIComponent("kind:FOLDER AND isRoot:true");
				opt.method = "GET";
			}, function(req) {
				req.end();
			}, function(err, res, requestId) {
				if(err) return call_cb(fname, cb, err);
				self.read_response(res, requestId, JSON.parse, function(err, body) {
					if(err) return call_cb(fname, cb, err);
					call_cb(fname, cb, null, body.data[0]);	
				});	
			}
		);
		break;

		default:
		self.create_folder_path(parse.dir, function(err, parent) {
			if(err) return call_cb(fname, cb, err);
			self.create_folder({ name: parse.name, kind: "FOLDER", parents: [ parent.id ] }, function(err, result) {
				if(err && err.message === "409") {
					return self.list_children(parent.id, { filters: "name:" + parse.name }, function(err, result){
						if(err) return call_cb(fname, cb, err);
						call_cb(fname, cb, null, result.data[0]);
					})
				}
				call_cb(fname, cb, err, result);
			});
		});
		break;
	}
	
}

Session.prototype.upload = function(metadata, stream, streamlength, cb) {
	var fname = "upload";
	debug(fname + "(%j)", metadata);
	var self = this;
	
	var form = new FormData();
	form.append('metadata', JSON.stringify(metadata));
	form.append('content', stream, streamlength? { knownLength: streamlength, filename: metadata.name } : undefined);
	
	form.getLength(function(err, length) {
		if(err) return call_cb(fname, cb, err);
		
		self.request(self.refresh_endpoint.bind(self),
			function(opt){
				opt.host = url.parse(self.endpoint.contentUrl).host;
				//opt.host = "localhost";
				opt.path = url.parse(self.endpoint.contentUrl).pathname + "nodes";
				opt.method = "POST";
				opt.headers['Content-Type'] = 'multipart/form-data; boundary=' + form.getBoundary();
				opt.headers['Content-Length'] = length;
			}, function(req) {
				form.pipe(req);
			}, function(err, res, requestId) {
				if(err) return call_cb(fname, cb, err);
				self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
			}
		);
	});
};

Session.prototype.download = function(nodeid, stream, cb) {
	var fname = "upload";
	debug(fname + "(%s)", nodeid);
	var self = this;
	
	self.request(self.refresh_endpoint.bind(self),
		function(opt){
			opt.host = url.parse(self.endpoint.contentUrl).host;
			opt.path = url.parse(self.endpoint.contentUrl).pathname + "nodes/" + nodeid + "/content";
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			res.pipe(stream);
			call_cb(fname, cb, null);
		}
	);
};

Session.prototype.overwrite = function(nodeid, stream, streamlength, cb) {
	var fname = "overwrite";
	debug(fname + "(%s)", nodeid);
	var self = this;
	
	var form = new FormData();
	form.append('content', stream, streamlength? { knownLength: streamlength, filename: metadata.name } : undefined);
	
	form.getLength(function(err, length) {
		if(err) return call_cb(fname, cb, err);
		
		self.request(self.refresh_endpoint.bind(self),
			function(opt){
				opt.host = url.parse(self.endpoint.contentUrl).host;
				//opt.host = "localhost";
				opt.path = url.parse(self.endpoint.contentUrl).pathname + "nodes/" + nodeid + "/content";
				opt.method = "PUT";
				opt.headers['Content-Type'] = 'multipart/form-data; boundary=' + form.getBoundary();
				opt.headers['Content-Length'] = length;
			}, function(req) {
				form.pipe(req);
			}, function(err, res, requestId) {
				if(err) return call_cb(fname, cb, err);
				self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
			}
		);
	});
};

Session.prototype.create_folder = function(metadata, cb) {
	var fname = "create_folder";
	debug(fname + "(%j)", metadata);
	var self = this;
	
	var data = JSON.stringify(metadata);
	self.request(self.refresh_endpoint.bind(self),
		function(opt){
			opt.host = url.parse(self.endpoint.metadataUrl).host;
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes";
			opt.method = "POST";
			opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
			opt.headers['Content-Length'] = Buffer.byteLength(data);
		}, function(req) {
			req.write(data);
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.move = function(nodeid, fromid, toid, cb) {
	var fname = "move";
	debug(fname + "(%s, %s, %s)", nodeid, fromid, toid);
	var self = this;
	
	var data = JSON.stringify({ fromParent: fromid, childId: nodeid });
	self.request(self.refresh_endpoint.bind(self),
		function(opt){
			opt.host = url.parse(self.endpoint.metadataUrl).host;
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes/" + toid + "/children";
			opt.method = "POST";
			opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
			opt.headers['Content-Length'] = Buffer.byteLength(data);
		}, function(req) {
			req.write(data);
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.add_child = function(parentid, childid, cb) {
	var fname = "add_child";
	debug(fname + "(%s, %s)", parentid, childid);
	var self = this;
	
	self.request(self.refresh_endpoint.bind(self),
		function(opt){
			opt.host = url.parse(self.endpoint.metadataUrl).host;
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes/" + parentid + "/children/" + childid;
			opt.method = "PUT";

		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.remove_child = function(parentid, childid, cb) {
	var fname = "remove_child";
	debug(fname + "(%s, %s)", parentid, childid);
	var self = this;
	
	self.request(self.refresh_endpoint.bind(self),
		function(opt){
			opt.host = url.parse(self.endpoint.metadataUrl).host;
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes/" + parentid + "/children/" + childid;
			opt.method = "DELETE";

		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.add_to_trash = function(nodeid, cb) {
	var fname = "add_to_trash";
	debug(fname + "(%s)", nodeid);
	var self = this;
	
	self.request(self.refresh_endpoint.bind(self),
		function(opt){
			opt.host = url.parse(self.endpoint.metadataUrl).host;
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "trash/" + nodeid;
			opt.method = "PUT";

		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

exports.Session = Session;
