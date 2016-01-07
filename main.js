var assert = require('assert');

var Api = require("./api");

var token = require("./token.json");

var session = new Api.Session(token);

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


/*session.resolve_path("/Pictures/", function(err, result) {
	console.log("resolve_path: %j, %j", err ? err.message : "", result);
	session.list("parents:" + result.id, function(err, result) {
		console.log("parents query: %j, %j", err ? err.message : "", result);
	});
});*/


session.upload(null, "test2", function(err, result) {
	console.log("upload: %j, %j", err ? err.message : "", result);
});



