var dsteem = require('dsteem');
var client = new dsteem.Client('https://api.steemit.com');
var constants = require("./utils/constants");

var app = {
  config: require('./config'),
  db: require('./utils/db'),

  run: function() {
    app.db.init();

  }
};

app.run();