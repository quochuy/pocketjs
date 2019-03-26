const constants = require("./constants");
const logger = require("./logger");

const validator = {
  sendCommand: constants.TOKEN_NAME + 'send:',

  constIdent: function(author, permlink) {
    return "@" + author + "/" + permlink;
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
      "Steem trxid: ([a-z0-9]+)", "m");

    match = re.exec(body);
    if (match) {
      return {
        amount: parseInt(match[1]),
        fromAccount: match[2],
        toAccount: match[3],
        newFromBalance: parseInt(match[4]),
        newToBalance: parseInt(match[5]),
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
      if (associated_ops.hasOwnProperty(extracted_op.trxid)) {
        const op_to_confirm = associated_ops[extracted_op.trxid];

        if (op_to_confirm.type !== 'genesis_confirm') {
          for (label in extracted_op) {
            if (extracted_op.hasOwnProperty(label)) {

              if (extracted_op.label !== op_to_confirm.label) {
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

  parseOP: function(op, trxid, database, blockNumber) {
    let mist_op = null;

    if (op[0] === 'comment') {
      if (validator.parentIsGenesis(op) || validator.isPocketSend(op)) {
        const body = op[1].body;

        if (body.indexOf(validator.sendCommand) === 0) {
          const sendTup = validator.parseSend(body);
          if (sendTup !== null) {
            const fromAccount = op[1].author;
             mist_op = {
              type:'send',
              toAccount: sendTup.toAccount,
              fromAccount: fromAccount,
              memo: sendTup.memo,
              amount: sendTup.amount,
              fee: constants.FEE,
              trxid: trxid
            };

            return mist_op;
          }
        } else if (body.indexOf('confirm') === 0) {
          mist_op = {
            type:'genesis_confirm',
            account: op[1].author,
            fee: constants.FEE,
            trxid: trxid
          };

          return mist_op;
        }
      } else { // check if it's a confirmation
        const parentIdent = validator.constIdent(op[1]['parent_author'], op[1]['parent_permlink']);
        const associated_ops = database.get_ops_for_ident(parentIdent);

        // associated_ops is a dictionary of trixd:mist_op pairs
        if (associated_ops !== null) {
          mist_op = validator.parseConfirm(associated_ops, op, parentIdent);
          return mist_op;
        }
      }
    } else if (op[0] === 'delete_comment') {
      const ident = validator.constIdent(op[1]['author'],op[1].permlink);
      const ops_to_confirm = database.get_ops_for_ident(ident); // unconfirmed ops associated with this ident

      if (ops_to_confirm !== null)  {
        const ops_to_remove = JSON.parse(JSON.stringify(ops_to_confirm));

        for (trxid in ops_to_remove)  {
          if (ops_to_remove.hasOwnProperty(trxid)) {
            // return fee to receiving account because now confirmation is impossible
            const op_to_confirm = ops_to_confirm.trxid;
            let fee_credit_account = '';

            if (op_to_confirm.type === 'send') {
              fee_credit_account = op_to_confirm.to_account;
            } else { // assume it's a genesis_confirm
              fee_credit_account = op_to_confirm.account;
            }

            logger.log('post deleted; crediting fee to ' + fee_credit_account);
            database.increase_account_balance(fee_credit_account, op_to_confirm.fee);
            database.remove_pending_confirmation(ident, op_to_confirm.trxid);
          }
        }
      }
    } else if (op[0] === 'custom_json') { // watch for reblogs of genesis post
      if (database.genesis_active()) {
        if (database.past_genesis_interval(blockNumber)) {
          database.deactivate_genesis();
        } else {
          // Payload will contain the data from the post being reblogged
          const payload = JSON.parse(op[1].json);

          // Validating that the user is reblogging the genesis post
          if (
            payload[0] === 'reblog'
            && payload[1].author === constants.GENESIS_ACCOUNT
            && payload[1].permlink === 'genesis-' + constants.TOKEN_NAME
          ) {
            logger.log("Genesis post reblogged by", payload[1].account);
            if (database.is_eligible(payload[1].account)) {
              database.credit_genesis(payload[1].account);
            }
          }
        }
      }
    }

    return mist_op;
  },

  balance_to_string: function(balance_int) {
    const balance_int_str = balance_int.toString();
    let balance_str = '';

    if (balance_int_str.length < 4) {
      balance_str = '0.' + '0' * (3 - balance_int_str.length) + balance_int_str;
    } else {
      balance_str = balance_int_str.substr(0, -3) + '.' + balance_int_str.substr(-3);
    }

    return balance_str;
  }
};

module.exports = validator;