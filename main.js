
var Api = require("./api");

var token = require("./token.json");

var session = new Api.Session(token);

session.account_endpoint(function(err, result) {
	console.log("endpoint: %j, %j", err, result);

	//session.list("kind:FOLDER AND isRoot:true", function(err, result) {
	//session.list("kind:FOLDER", function(err, result) {
	session.resolve_path("/Pictures", function(err, result) {
		console.log("resolve_path: %j, %j", err ? err.message : "", result);
	});

});

