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


session.list("name:test2", function(err, result) {
	console.log("session.list \"name:test2\": %j, %j", err ? err.message : "", result);
	console.log(result.data[0].id);
	session.download(result.data[0].id, process.stdout, function(err, result) {
		console.log("download: %j", err ? err.message + "\n" + err.stack : "");
	});
});


