const assert = require('assert');
const val = require('../utils/validator');
const database = require('../utils/db');

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

    it('should parse blockchain operation as a send commend', function () {
      const result = val.parseOP(
        [ 'comment',
          { parent_author: 'gypsyfortune',
            parent_permlink: 'ooes2za4nwdg1vjk9mqzvvu1nv29ufou',
            author: 'pode',
            permlink: 're-gypsyfortune-ooes2za4nwdg1vjk9mqzvvu1nv29ufou-20180619t025406544z\n',
            title: '',
            body: 'pocketsend:11@gypsyfortune, play around with the token of fun - POCKET!\n',
            json_metadata: ''
          }
        ],
        '63a054e2a05f510ed55bc892f5686cc90ef35234',
        database
      );

      assert.equal(result.type, 'send');
      assert.equal(result.toAccount, 'gypsyfortune');
      assert.equal(result.fromAccount, 'pode');
      assert.equal(result.memo, ' play around with the token of fun - POCKET!');
      assert.equal(result.fee, 1);
      assert.equal(result.trxid, '63a054e2a05f510ed55bc892f5686cc90ef35234');
    });

    it('should parse as a send commend', function () {
      const mist_op = val.parseOP(
        [ 'comment',
          { parent_author: 'gypsyfortune',
            parent_permlink: 'ooes2za4nwdg1vjk9mqzvvu1nv29ufou',
            author: 'pode',
            permlink: 're-gypsyfortune-ooes2za4nwdg1vjk9mqzvvu1nv29ufou-20180619t025406544z',
            title: '',
            body: 'pocketsend:11@gypsyfortune, play around with the token of fun - POCKET!\n',
            json_metadata: ''
          }
        ],
        '63a054e2a05f510ed55bc892f5686cc90ef35234',
        database
      );

      assert.equal(mist_op.type, 'send');
      assert.equal(mist_op.toAccount, 'gypsyfortune');
      assert.equal(mist_op.fromAccount, 'pode');
      assert.equal(mist_op.memo, ' play around with the token of fun - POCKET!');
      assert.equal(mist_op.fee, 1);
      assert.equal(mist_op.trxid, '63a054e2a05f510ed55bc892f5686cc90ef35234');
    });

    it('should parse as a send confirmation command', function () {
      const sendOp = [ 'comment',
        { parent_author: 'ninegagbot',
          parent_permlink: 'this-is-not-a-diorama--it-s-a-real-island-full-of-people-who-survived-the-floods-in-malaysia--mpcyzh',
          author: 'pode',
          permlink: 're-ninegagbot-this-is-not-a-diorama--it-s-a-real-island-full-of-people-who-survived-the-floods-in-malaysia--mpcyzh-20180618t234706793z',
          title: '',
          body: 'pocketsend:11@ninegagbot, play around with the token of fun - POCKET!',
          json_metadata: ''
        }
      ];
      let mist_op = val.parseOP(
        sendOp,
        '034a3d7828ce028e20fa6e4f5857299d606ca8aa',
        database
      );

      database.enqueue_for_confirmation(mist_op, sendOp);

      mist_op = val.parseOP(
        [ 'comment',
          { parent_author: 'pode',
            parent_permlink: 're-ninegagbot-this-is-not-a-diorama--it-s-a-real-island-full-of-people-who-survived-the-floods-in-malaysia--mpcyzh-20180618t234706793z',
            author: 'steemulant',
            permlink: 're-pode-034a3d7828ce028e20fa6e4f5857299d606ca8aa',
            title: '',
            body: 'Successful Send of 11\nSending Account: pode\nReceiving Account: ninegagbot\nNew sending account balance: 129912\nNew receiving account balance: 400\nFee: 1\nSteem trxid: 034a3d7828ce028e20fa6e4f5857299d606ca8aa\nThanks for using [POCKET](https://steemit.com/pocket/@biophil/pocket-announcement)! I am running [this confirmer code.](https://github.com/biophil/pocket)\n',
            json_metadata: ''
          }
        ],
        'e903e552e68803ddb793a3622ed99c832c054f7e',
        database
      );

      assert.equal(mist_op.type, 'confirmation');
      assert.equal(mist_op.confirmer, 'steemulant');
      assert.equal(mist_op.fee, 1);
      assert.equal(mist_op.associated_trxid, '034a3d7828ce028e20fa6e4f5857299d606ca8aa');
    });
  });
});