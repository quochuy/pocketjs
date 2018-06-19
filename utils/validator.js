const md5 = require('md5');
const constants = require("./constants");

const validator = {
  sendCommand: constants.TOKEN_NAME + 'send:',

  constIdent: function(author, permlink) {
    return md5(author + permlink);
  },

  /**
   * send is a string "send:<amount>@<to_account>,<optional-memo>"
   * @param send
   */
  parseSend: function(send) {
    const re = new RegExp('^' + validator.sendCommand + '(\\d+)@([a-z][a-z0-9-.]{2,15})(,.*|$)', 'm');
    const match = re.exec(send);
    if (match) {
      const amount = match[1];
      const toAccount = match[2];
      const memo = match[3];

      return {
        amount: amount,
        toAccount: toAccount,
        memo: memo.substr(1)
      };
    }

    return null;
  },

  /**
   * looks at the body of a post to see if it's a properly-formatted confirmation
   * if format is proper, it returns the operation that it's supposedly confirming
   * otherwise, it returns None
   *
   * body should be a string :
   * "Successful Send of <send_amount>\n"
   * "Sending Account: <from_account_name>\n"
   * "Receiving Account : <to_account_name>\n"
   * "New sending account balance: <from_account_balance>\n"
   * "New receiving account balance: <to_account_balance>\n"
   * "Fee: <fee>\n"
   * "Steem trxid: <trxid>\n"
   * "<arbitrary string>"
   *
   * @param body
   */
  getConfirmPayload: function(body) {
    const genesis_conf_start = "Success! You claimed a genesis stake of " + constants.GENESIS_CREDIT + ".\n";
    let re = new RegExp('^' + genesis_conf_start + 'trxid:([a-z0-9]+)\n', 'm');
    let match = re.exec(body);

    if (match) {
      return {trxid: match[1]};
    }

    re = new RegExp("^Successful Send of (\\d+)\n" +
      "Sending Account: ([a-z][a-z0-9-.]{2,15})\n" +
      "Receiving Account: ([a-z][a-z0-9-.]{2,15})\n" +
      "New sending account balance: (\\d+)\n" +
      "New receiving account balance: (\\d+)\n" +
      "Fee: (\\d+)\n" +
      "Steem trxid: ([a-z0-9]+)\n" +
      "Thanks for using POCKET! I am running this confirmer code.", "m");

    match = re.exec(body);
    if (match) {
      return {
        amount: parseInt(match[1]),
        from_account: match[2],
        to_account: match[3],
        new_from_balance: parseInt(match[4]),
        new_to_balance: parseInt(match[5]),
        fee: parseInt(match[6]),
        trxid: match[7]
      };
    }

    return null;
  },

  /**
   * checks the confirmation post in steem_op against the requested confirmation in op_to_confirm
   * body should be a string "Success!\nNew sending account balance: <from_account_balance>\nNew receiving account balance: <to_account_balance>\n"
   * an issue here is that we parse the entire confirmation before we know if it's actually a needed one.
   *
   * @param associated_ops
   * @param steem_op
   * @param parentIdent
   * @returns {*}
   */
  parseConfirm: function(associated_ops, steem_op, parentIdent) {
    const body = steem_op[1].body;
    const extracted_op = validator.getConfirmPayload(body);

    if (extracted_op !== null) {
      if (associated_ops.hasOwnProperty(extracted_op)) {
        const op_to_confirm = associated_ops[extracted_op.trxid];
        if (op_to_confirm.type !== 'genesis_confirm') {
          for (label in extracted_op) {
            if (extracted_op.hasOwnProperty(label)) {
              if (extracted_op[label] !== op_to_confirm[label]) {
                // discrepancy found, so exit
                return null;
              }
            }
          }
        }

        const mist_op = {
          type: 'confirmation',
          confirmer: steem_op[1].author,
          fee: op_to_confirm.fee,
          associated_ident: parentIdent,
          associated_trxid:  extracted_op.trxid
        };

        return mist_op;
      }
    }

    return null;
  },

  parentIsGenesis: function(op) {
    return (op[1].parent_author === constants.GENESIS_ACCOUNT) && (op[1].parent_permlink === constants.GENESIS_PERMLINK);
  },

  isPocketSend: function(op) {
    return op[1].body.substr(0, validator.sendCommand.length) === validator.sendCommand;
  },

  parseOP: function(op,trxid,DB) {
    if (op[0] === 'comment') {

    } else if (op[0] === 'delete_comment') {

    }

    return null;
  }
};

module.exports = validator;