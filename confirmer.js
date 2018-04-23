var dsteem = require('dsteem');
var client = new dsteem.Client('https://api.steemit.com');
var constants = require("./utils/constants");

var app = {
  config: require('./config'),
  db: require('./utils/db'),

  run: function() {
    app.db.init();

    console.log(app.db.get_top_accounts(5));
    console.log('------------');
    console.log(app.db.get_bottom_accounts(5));
  }
};

app.run();