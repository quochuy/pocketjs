const assert = require('assert');
const val = require('../utils/validator');

describe('Command validator', function() {
  describe('Send command', function () {
    it('should validate pocketsend:11@quochuy,with a nice memo', function () {
      const send = val.parseSend('pocketsend:11@quochuy,with a nice memo');
      assert.equal(send.amount, 11);
      assert.equal(send.toAccount, 'quochuy');
      assert.equal(send.memo, 'with a nice memo');
    });

    it('should validate pocketsend:11@quochuy', function () {
      const send = val.parseSend('pocketsend:11@quochuy');
      assert.equal(send.amount, 11);
      assert.equal(send.toAccount, 'quochuy');
      assert.equal(send.memo, '');
    });

    it('should validate pocketsend:11@quochuy,', function () {
      const send = val.parseSend('pocketsend:11@quochuy,');
      assert.equal(send.amount, 11);
      assert.equal(send.toAccount, 'quochuy');
      assert.equal(send.memo, '');
    });

    it('should validate pocketsend:11@quochuy with multiple lines', function () {
      const send = val.parseSend("pocketsend:11@quochuy\nline2\nline3");
      assert.equal(send.amount, 11);
      assert.equal(send.toAccount, 'quochuy');
      assert.equal(send.memo, '');
    });

    it('should validate pocketsend:11@quochuy,memo with multiple lines', function () {
      const send = val.parseSend("pocketsend:11@quochuy,memo\nline2\nline3");
      assert.equal(send.amount, 11);
      assert.equal(send.toAccount, 'quochuy');
      assert.equal(send.memo, 'memo');
    });

    it('should not validate tokensend:11@quochuy', function () {
      const send = val.parseSend('tokensend:11@quochuy');
      assert.equal(send, null);
    });

    it('should not validate pocketsend:abc@quochuy', function () {
      const send = val.parseSend('pocketsend:anc@quochuy');
      assert.equal(send, null);
    });

    it('should not validate pocketsend:abc@1111', function () {
      const send = val.parseSend('pocketsend:anc@1111');
      assert.equal(send, null);
    });

    it('should not validate pocketsend:11@quochuy$', function () {
      const send = val.parseSend('pocketsend:anc@quochuy$');
      assert.equal(send, null);
    });
  });

  describe('Confirm command', function () {
    it('should validate genesis claim', function () {
      const send = val.getConfirmPayload(
        "Success! You claimed a genesis stake of 1000001.\n" +
        "trxid:39e9bdeaf8289984848aa26fc6c02eb27c6f7f5d\n" +
        "Thanks for using POCKET! I am running this confirmer code."
      );
      assert.equal(send.trxid, "39e9bdeaf8289984848aa26fc6c02eb27c6f7f5d");
    });

    it('should validate valid confirmation comment', function () {
      const send = val.getConfirmPayload(
        "Successful Send of 5001\n" +
        "Sending Account: mattclarke\n" +
        "Receiving Account: jarradlevi\n" +
        "New sending account balance: 1094031\n" +
        "New receiving account balance: 5007\n" +
        "Fee: 1\n" +
        "Steem trxid: 5dfdddfb48bf29365867e98f4eea5aba200a3e44\n" +
        "Thanks for using POCKET! I am running this confirmer code."
      );

      assert.equal(send.amount, 5001);
      assert.equal(send.from_account, "mattclarke");
      assert.equal(send.to_account, "jarradlevi");
      assert.equal(send.new_from_balance, 1094031);
      assert.equal(send.new_to_balance, 5007);
      assert.equal(send.fee, 1);
      assert.equal(send.trxid, "5dfdddfb48bf29365867e98f4eea5aba200a3e44");
    });

    it('should validate invalid confirmation comment', function () {
      const send = val.getConfirmPayload(
        "Successful Send of 5001\n" +
        "Receiving Account: jarradlevi\n" +
        "New sending account balance: 1094031\n" +
        "New receiving account balance: 5007\n" +
        "Thanks for using POCKET! I am running this confirmer code."
      );

      assert.equal(send, null);
    });
  });
});