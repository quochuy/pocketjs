const steemHelper = require('./steemhelper');
const validator = require('./validator');
const constants = require('./constants');
const logger = require('./logger');

/**
 * note: this module is only for stuff that deals with posting confirmations,
 * NOT validating them.
 *
 * @type {{labels: {amount: string, from_account: string, to_account: string, new_from_balance: string, new_to_balance: string, fee: string, trxid: string}, confirm_op: confirmation.confirm_op}}
 */
const confirmation = {
  labels: {
    amount: "Successful Send of ",
    from_account: "Sending Account: ",
    to_account: "Receiving Account: ",
    new_from_balance: "New sending account balance: ",
    new_to_balance: "New receiving account balance: ",
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
      return int_amount.toString();
    }
  },

  /**
   *
   * @param ident
   * @param needed_confirmation
   * @param s
   * @param confirmer_account
   * @param confirm_message
   * @returns {Promise<void>}
   */
  confirm_op: async function(ident, needed_confirmation, s, confirmer_account, confirm_message) {
    // first get a list of valid confirmations already posted to this ident
    const authorPermlink = steemHelper.getAuthorPermlinkFromUrl(ident);
    const top_level = await steemHelper.getPost(authorPermlink.author, authorPermlink.permlink);

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

          body += confirm_message;

          const confirmationPermlink = steemHelper.formatter.sanitizePermlink(
            're-' + top_level.author + '-' + needed_confirmation['trxid']
          );

          try {
            await steemHelper.comment(top_level, body, confirmationPermlink);
            logger.log('confirmed: ' + needed_confirmation['trxid'])
          } catch(err) {
            logger.log("[error][steemcomment]", err);
          }
        }
      }
    }
  }
};

module.exports = confirmation;