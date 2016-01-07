'use strict';

var https = require('https');
var http = require('http');
var fs = require('fs');
var querystring = require('querystring');
var util = require('util');
var EventEmitter = require('events');
var url = require('url');
var path = require('path');
var FormData = require('form-data');

var Session = function(token) {
	this.token = token;

} 

util.inherits(Session, EventEmitter);

Session.prototype.read_response = function(res, transform, cb) {
	var result = "";
	res.setEncoding('utf8');
	res.on('data', function (chunk) {
		console.log("Response Chunk: %s", chunk);
		result += chunk;
	});
	res.on('end', function() {
		try {	
			cb(null, transform(result));
		} catch(err) {
			cb(err);
		}
	});
}

Session.prototype.refresh_endpoint = function(cb_res) {
	var self = this;
	if(self.endpoint) cb_res(null, self.endpoint);
	console.log("no endpoint");
	self.account_endpoint( function(err, data) {
		if(err) return cb_res(err);
		self.endpoint = data;
		self.emit("newEndpoint", self.endpoint);
		cb_res(null, self.endpoint);
	});
}


Session.prototype.request = function(cb_pre, cb_opt, cb_req, cb_res) {
	var self = this;
	console.log("request starting");
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
	console.log("## Request ##\nOptions: %j\n##", req_options);
	var module = (req_options.host === "localhost") ? http : https;
	var req = module.request(req_options, function(res) {
		console.log("## Response ##\nURL: %s\nStatusCode: %d\nHeaders: %j\n##", req_options.host+req_options.path, res.statusCode, res.headers);
		switch(res.statusCode) {
			case 401: {
				var data = querystring.stringify({
					refresh_token: self.token.refresh_token
				});
				var req = https.request({
					host: "acdc-1163.appspot.com",
					path: "/",
					method: "POST",
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'Content-Length': Buffer.byteLength(data)
					}
				}, function(res) {
					self.read_response(res, JSON.parse, function(err, body) {
						self.token = body;
						self.emit("newToken", self.token);
						self.request(cb_pre, cb_opt, cb_req, cb_res);
					});
				});
				req.write(data);
				req.end();
			}
			break;
			case 200:
			case 201:
				cb_res(null, res);
			break;
			default:
				cb_res(new Error(res.statusCode), res);
			break;
		}
	});
	cb_req(req);
};

Session.prototype.account_endpoint = function(cb) {
	var self = this;
	self.request(null,
		function(opt) {
			opt.host = "drive.amazonaws.com";
			opt.path = "/drive/v1/account/endpoint";
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res) {
			if(err) return cb(err);
			self.read_response(res, JSON.parse, function(err, body) {
				if(err) return cb(err);
				cb(null, body);					
		});
	});
};


Session.prototype.list = function(filters, cb) {
	var self = this;
	self.request(self.refresh_endpoint.bind(self),
		function(opt) {
			opt.host = url.parse(self.endpoint.metadataUrl).host
			opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes?filters=" + encodeURIComponent(filters);
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res) {
			if(err) return cb(err);
			self.read_response(res, JSON.parse, function(err, body) {
				if(err) return cb(err);
				cb(null, body);	
				
			});
		
	});
};


var AcdcError = function(code, message) {
	this.code = code;
	this.message = message;
}


Session.prototype.resolve_path = function(node_path, cb) {
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
			}, function(err, res) {
				if(err) return cb(err);
				self.read_response(res, JSON.parse, function(err, body) {
					if(err) return cb(err);
					cb(null, body.data[0]);	
				});	
			});
		break;

		default:
		self.resolve_path(parse.dir, function(err, node) {
			self.request(self.refresh_endpoint.bind(self),
				function(opt) {
					opt.host = url.parse(self.endpoint.metadataUrl).host;
					opt.path = url.parse(self.endpoint.metadataUrl).pathname + "nodes/" + node.id + "/children?filters=name:" + encodeURIComponent(parse.name);
					opt.method = "GET"
				}, function(req) {
					req.end();
				}, function(err, res) {
					if(err) return cb(err);
					self.read_response(res, JSON.parse, function(err, body) {
						if(err) return cb(err);
						if(!body.data || !body.data[0]) return cb(new AcdcError("ENOENT", "No such file or directory"));
						cb(null, body.data[0]);	
					});
				});
		});
		break;
	}
	
}

Session.prototype.upload = function(metadata, filepath, cb) {
	var self = this;
	
	metadata = metadata || {};
	metadata.name = metadata.name || url.parse(filepath).pathname;
	metadata.kind = metadata.kind || "FILE";

	var form = new FormData();
	form.append('metadata', JSON.stringify(metadata));
	form.append('content', fs.createReadStream(filepath));
	console.log("upload>metadata: %s", JSON.stringify(metadata));
	
	form.getLength(function(err, length) {
		if(err) return cb(err);
		console.log("upload>getLength: %d", length);
		
		self.request(self.refresh_endpoint.bind(self),
			function(opt){
				opt.host = url.parse(self.endpoint.contentUrl).host;
				//opt.host = "localhost";
				opt.path = url.parse(self.endpoint.contentUrl).pathname + "nodes";
				opt.method = "POST";
			}, function(req) {
				req.setHeader('Content-Type', 'multipart/form-data; boundary=' + form.getBoundary());
				req.setHeader('Content-Length', length);
				form.pipe(req);
			}, function(err, res) {
				if(err) return cb(err);
				self.read_response(res, JSON.parse, function(err, body) {
					if(err) return cb(err);
					cb(null, body);	
				});
			});
	});
};

Session.prototype.download = function(nodeid, stream, cb) {
	var self = this;
	
	self.request(self.refresh_endpoint.bind(self),
		function(opt){
			opt.host = url.parse(self.endpoint.contentUrl).host;
			opt.path = url.parse(self.endpoint.contentUrl).pathname + "nodes/" + nodeid + "/content";
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res) {
			if(err) return cb(err);
			res.pipe(stream);
			cb(null, res);
		});
};

Session.prototype.overwrite = function(nodeid, filepath, cb) {
	var self = this;
	
	var form = new FormData();
	form.append('content', fs.createReadStream(filepath));
	
	form.getLength(function(err, length) {
		if(err) return cb(err);
		console.log("upload>getLength: %d", length);
		
		self.request(self.refresh_endpoint.bind(self),
			function(opt){
				opt.host = url.parse(self.endpoint.contentUrl).host;
				//opt.host = "localhost";
				opt.path = url.parse(self.endpoint.contentUrl).pathname + "nodes/" + nodeid + "/content";
				opt.method = "PUT";
			}, function(req) {
				req.setHeader('Content-Type', 'multipart/form-data; boundary=' + form.getBoundary());
				req.setHeader('Content-Length', length);
				form.pipe(req);
			}, function(err, res) {
				if(err) return cb(err);
				self.read_response(res, JSON.parse, function(err, body) {
					if(err) return cb(err);
					cb(null, body);	
				});
			});
	});
};

exports.Session = Session;
