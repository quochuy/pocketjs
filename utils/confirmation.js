const steemHelper = require('./steemhelper');

const confirmation = {
  labels: {
    amount: "Successful Send of ",
    from_account: "Sending Account: '",
    to_account: "Receiving Account: ",
    new_from_balance: "New sending account balance: ",
    new_to_balance: "New receiving account balance: ",
    fee: "Fee: ",
    trxid: "teem trxid: "
  },

  confirm_op: function(ident, needed_confirmation, s, confirmer_account, confirm_message) {
    // first get a list of valid confirmations already posted to this ident
    const authorPermlink = steemHelper.getAuthorPermlinkFromUrl(ident);
    const top_level = steemHelper.getPost(authorPermlink.author, authorPermlink.permlink);
    console.log(top_level);
    process.exit();
  }
};

module.exports = confirmation;