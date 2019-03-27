const steemHelper = require('./steemhelper');
const validator = require('./validator');
const constants = require('./constants');
const logger = require('./logger');
const config = require('../config/config');
const cache = require('./cache');

/**
 * note: this module is only for stuff that deals with posting confirmations,
 * NOT validating them.
 * @type {{labels: {amount: string, fromAccount: string, toAccount: string, newFromBalance: string, newToBalance: string, fee: string, trxid: string}, str_labels: string[], format_amount: confirmation.format_amount, confirm_op: confirmation.confirm_op}}
 */
const confirmation = {
  labels: {
    amount: "Successful Send of ",
    fromAccount: "Sending Account: ",
    toAccount: "Receiving Account: ",
    newFromBalance: "New sending account balance: ",
    newToBalance: "New receiving account balance: ",
    fee: "Fee: ",
    trxid: "Steem trxid: "
  },

  str_labels: ['from_account', 'to_account', 'trxid'],

  /**
   *
   * @param int_amount
   * @returns {string}
   */
  format_amount: function(int_amount) {
    if (int_amount < 0) {
      throw "amount cannot be less than zero.";
    } else {
      return int_amount;
    }
  },

  /**
   *
   * @param ident
   * @param needed_confirmation
   * @returns {Promise<*>}
   */
  confirm_op: async function(ident, needed_confirmation) {
    // first get a list of valid confirmations already posted to this ident
    const authorPermlink = steemHelper.getAuthorPermlinkFromUrl(ident);
    const top_level = await steemHelper.getPost(authorPermlink.author, authorPermlink.permlink);
    const confirmationPermlink = steemHelper.formatter.sanitizePermlink(
      're-' + top_level.author + '-' + needed_confirmation['trxid']
    );

    const cacheData = cache.get(confirmationPermlink);

    if (!cacheData) {
      if (top_level !== null) {
        const replies = await steemHelper.getReplies(top_level.author, top_level.permlink);

        if (replies !== null) {
          const possibleConfirmations = [];

          for (let ri=0; ri<replies.length; ri++) {
            const reply = replies[ri];
            possibleConfirmations.push(validator.getConfirmPayload(reply.body));
          }

          let found_match = false;
          // for each reply, I need to check if it corresponds to the one we need.
          // if no reply corresponds to the one we need, then post a conf.
          // Or, if every reply does *not* match, then post a conf.
          for (let pci=0; pci<possibleConfirmations.length; pci++) {
            const possibleConfirmation = possibleConfirmations[pci];
            if (possibleConfirmation !== null) {
              let this_not_match = false;

              for (let label in possibleConfirmation) {
                if (possibleConfirmation.hasOwnProperty(label)) {
                  if (needed_confirmation[label] !== possibleConfirmations[label]) {
                    // being here means that poss_conf is *not* a match
                    this_not_match = true;

                    // don't waste time checking the rest
                    break;
                  }
                }
              }

              // got thru one without a discrepancy
              if (this_not_match === false) {
                found_match = true;
                break;
              }
            }
          }

          // found match means I found one conf that is completely right
          if (found_match === false) {
            let body = '';

            if (needed_confirmation['type'] === 'send') {
              for (let label in confirmation.labels) {
                let conf_data = null;

                if (confirmation.labels.hasOwnProperty(label)) {
                  const string = confirmation.labels[label];

                  if (confirmation.str_labels.indexOf(label) !== -1) {
                    conf_data = needed_confirmation[label];
                  } else {
                    conf_data = confirmation.format_amount(needed_confirmation[label]);
                  }

                  body += string + conf_data + "\n";
                }
              }
            } else if (needed_confirmation['type'] === 'genesis_confirm') {
              body += 'Success! You claimed a genesis stake of ' + constants.GENESIS_CREDIT + '.\n';
              body += 'trxid:' + needed_confirmation['trxid'] + '\n';
            }

            body += config.confirm_message;

            try {
              logger.log('confirmed: ' + needed_confirmation['trxid'] + ' in block #' + result.result.block_num);
              cache.set(confirmationPermlink, result);

              return {
                parentPermLink: top_level,
                body: body,
                permlink: confirmationPermlink
              };
            } catch(err) {
              logger.log("[error][steemcomment]", err);
            }

            return true;
          } else {
            logger.log("Transaction already confirmed");
          }
        }
      }
    } else {
      logger.log('Confirmation already posted');
    }

    return false;
  }
};

module.exports = confirmation;