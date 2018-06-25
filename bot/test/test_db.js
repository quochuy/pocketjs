var assert = require('assert');
var constants = require('../utils/constants');
var db = require('../utils/db');
db.init();
db.outputLogs = false;

describe('MIST DB', function() {
  describe('Load DB file', function() {
    it('should load db.json and find the account property', function() {
      assert.ok(db.db.accounts);
    });
  });

  describe('Genesis', function() {
    it('account balance should receive an increase of credits from genesis', function() {
      var currentCredit = db.get_account_balance('quochuy');
      db.credit_genesis('quochuy');
      var newCredit = db.get_account_balance('quochuy');

      assert.equal(currentCredit + constants.GENESIS_CREDIT, newCredit);
    });
  });

  describe('Account balance', function() {
    it('should be able to increase balance by specific amount', function() {
      var currentCredit = db.get_account_balance('quochuy');
      db.increase_account_balance('quochuy', 101);
      var newCredit = db.get_account_balance('quochuy');

      assert.equal(currentCredit + 101, newCredit);
    });

    it('should be able to decrease balance by specific amount', function() {
      var currentCredit = db.get_account_balance('quochuy');
      db.decrease_account_balance('quochuy', 101);
      var newCredit = db.get_account_balance('quochuy');

      assert.equal(currentCredit - 101, newCredit);
    });
  });

  describe('Sending POCKETS', function() {
    it('should not be able to send negative amount', function() {
      var success = db.add_op({type: 'send', fromAccount: 'quochuy', toAccount: 'quochuy', amount: -1});

      assert.equal(success, false);
    });

    it('should not be able to send zeroed amount', function() {
      var success = db.add_op({type: 'send', fromAccount: 'quochuy', toAccount: 'quochuy', amount: 0});

      assert.equal(success, false);
    });

    it('should not be able to send from inexisting account', function() {
      var success = db.add_op({type: 'send', fromAccount: '1234567890welcomemonkey', toAccount: 'quochuy', amount: 0});

      assert.equal(success, false);
    });

    it('should not be able to send from more than account balance', function() {
      var success = db.add_op({type: 'send', fromAccount: 'quochuy', toAccount: 'quochuy', amount: 1000000000});

      assert.equal(success, false);
    });

    it('successful sending should decrease from account and increase to existing account of the amount sent', function() {
      var balance1 = db.get_account_balance('quochuy');
      var balance2 = db.get_account_balance('biophil');
      db.add_op({type: 'send', fromAccount: 'quochuy', toAccount: 'biophil', amount: 101, fee: 1});
      var balance1new = db.get_account_balance('quochuy');
      var balance2new = db.get_account_balance('biophil');

      assert.equal(balance1 - 101, balance1new);
      assert.equal(balance2 + 100, balance2new);
    });

    it('successful sending should decrease from account and increase to new account of the amount sent', function() {
      var balance1 = db.get_account_balance('quochuy');
      console.log(balance1);

      db.add_op({type: 'send', fromAccount: 'quochuy', toAccount: 'newuserontheblockohyea', amount: 101, fee: 1});

      var balance1new = db.get_account_balance('quochuy');
      var balance2new = db.get_account_balance('newuserontheblockohyea');
      console.log(balance1);
      console.log(balance1new);

      assert.equal(balance1 - 101, balance1new);
      assert.equal(100, balance2new);
    });

    it('adding confirmation should increase confirmer account by fee amount', function() {
      var balance = db.get_account_balance('steemulant');
      db.add_op({type: 'confirmation', fromAccount: 'quochuy', toAccount: 'newuserontheblockohyea', amount: 101, fee: 1, confirmer: 'steemulant'});
      var balancenew = db.get_account_balance('steemulant');

      assert.equal(balance + 1, balancenew);
    });


  });

});