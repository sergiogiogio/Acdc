'use strict';

const https = require('https');
const querystring = require('querystring');
const util = require('util');
const EventEmitter = require('events');
const url = require('url');
const path = require('path');

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

Session.prototype.request = function(options, cb_req, cb_res) {
	const self = this;
	console.log("request starting");
	if(!options.host && !self.endpoint) {
		console.log("no endpoint");
		self.account_endpoint( function(err, data) {
			if(err) return cb_res(err);
			self.endpoint = data;
			self.emit("newEndpoint", self.endpoint);
			self.request(options, cb_req, cb_res);
		});
		return;
	}
	var parsedMetadataUrl;
	if(self.endpoint) {
		parsedMetadataUrl = url.parse(self.endpoint.metadataUrl);
	}
	var req_options = {
		host: options.host || parsedMetadataUrl.host,
		path: options.host ? options.path : parsedMetadataUrl.pathname + options.path,
		method: options.method,
		headers: {
			"Authorization": "Bearer " + self.token.access_token
		}
	};
	console.log("## Request ##\nOptions: %j\n##", req_options);
	var req = https.request(req_options, function(res) {
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
						self.request(options, cb_req, cb_res);
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
	const self = this;
	this.request({
		host: "drive.amazonaws.com",
		path: "/drive/v1/account/endpoint",
		method: "GET"
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
	const self = this;
	self.request({
		path: "nodes?filters=" + encodeURIComponent(filters),
		method: "GET"
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
	const self = this;
	var parse = path.parse(node_path);
	switch(parse.base) {
		case "":
		self.request({
			path: "nodes?filters=" + encodeURIComponent("kind:FOLDER AND isRoot:true"),
			method: "GET"
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
			self.request({
				path: "nodes/" + node.id + "/children?filters=name:" + encodeURIComponent(parse.name),
				method: "GET"
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

exports.Session = Session;
