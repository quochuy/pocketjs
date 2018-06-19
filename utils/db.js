const constants = require("./constants");
const fs = require('fs');
const _ = require('lodash');
const validator = require('./validator');

Array.prototype.remove = function() {
  var what, a = arguments, L = a.length, ax;
  while (L && this.length) {
    what = a[--L];
    while ((ax = this.indexOf(what)) !== -1) {
      this.splice(ax, 1);
    }
  }
  return this;
};

const MistDB = {
  dbFname: 'db.json',
  db: null,
  outputLogs: true,

  init: function() {
    this.load();
  },

  was_interrupted: function() {
    if (!this.db.hasOwnProperty('interrupted')) {
      this.db.interrupted = false;
    }

    return this.db.interrupted;
  },

  update_interrupted: function(interrupted) {
    this.db.interrupted = interrupted;
  },

  update_last_tx_id: function(txid) {
    this.db.last_processed_transaction_id = txid;
  },

  last_tx_id: function() {
    if (!this.db.hasOwnProperty('last_processed_transaction_id')) {
      this.db.last_processed_transaction_id = 0;
    }

    return this.db.last_processed_transaction_id;
  },

  update_last_block: function(lastBlock) {
    this.db.last_block = lastBlock;
  },

  last_parsed_block: function() {
    return this.db.last_block;
  },

  active: function() {
    return this.db.active;
  },

  genesis_active: function() {
    return this.db.genesis_active;
  },

  past_genesis_interval: function(block) {
    return block > this.db.genesis_last_block;
  },

  activate: function() {
    this.db.active = true;
  },

  activate_genesis: function(block) {
    this.db.genesis_active = true;
    this.db.genesis_in_block = block;
    this.db.genesis_last_block = block + constants.GENESIS_INTERVAL;

    this.save('pending_backup.p', this.db.pending_accounts);
    this.save('eligible_backup.p', this.db.eligible_accounts);

    this.db.pending_accounts = {};

    this.log('GENESIS ACTIVATED!');
  },

  deactivate_genesis: function() {
    this.db['genesis_active'] = false;
    this.db['eligible_accounts'] = [];

    this.log('GENESIS DEACTIVATED');
  },

  credit_genesis: function(account) {
    this.increase_account_balance(account, constants.GENESIS_CREDIT);

    if(this.db.eligible_accounts.indexOf(account) !== -1) {
      this.db.eligible_accounts.remove(account);
    }

    this.db.pending_genesis_confirms.push(account);
  },

  get_account_balance: function(account) {
    return _.get(this.db.accounts, [account, 'balance'], 0);
  },

  increase_account_balance: function(account, amount) {
    if (_.has(this.db.accounts, [account, 'balance'])) {
      this.db.accounts[account].balance += amount;
      this.log(amount + ' added to account ' + account);
    } else {
      this.db.accounts[account] = {balance: amount};
      this.log(amount + ' added to account ' + account);
    }
  },

  decrease_account_balance: function(account, amount) {
    if(this.get_account_balance(account) >= amount) {
      this.db.accounts[account].balance -= amount;
      this.log(amount + ' deducted from account ' + account);
    } else {
      this.log('Insufficient balance in account ' + account);
    }
  },

  add_send: function(mist_op) {
    var send_successful = false,
        from_account = mist_op.from_account,
        to_account = mist_op.to_account,
        amount = mist_op.amount;

    if(amount > 0) {
      if (_.has(this.db.accounts, [from_account, 'balance'])) {
        if(this.db.accounts[from_account].balance >= amount) {
          this.db.accounts[from_account].balance -= amount;
          send_successful = true;
          this.log(amount + ' deducted from account ' + from_account);
        } else {
          this.log('insufficient balance in account ' + from_account);
        }
      } else {
        this.log('I have no record of account ' + from_account);
      }

      if (send_successful) {
        if (_.has(this.db.accounts, [to_account, 'balance'])) {
          this.db.accounts[to_account].balance += amount - mist_op.fee;
          this.log((amount - mist_op.fee) + ' added to account (1) ' + to_account);
        } else {
          this.db.accounts[to_account] = {balance: amount - mist_op.fee};
          this.log((amount - mist_op.fee) + ' added to account (2) ' + to_account);
        }
      }
    }

    return send_successful;
  },

  add_confirmation: function(mist_op) {
    if(mist_op.fee > 0) {
      this.increase_account_balance(mist_op.confirmer, mist_op.fee);
    }

    this.remove_pending_confirmation(mist_op.associated_ident, mist_op.associated_trxid);

    return true;
  },

  add_genesis_confirm: function(mist_op) {
    account = mist_op.account;
    if(
      this.db.pending_genesis_confirms.indexOf(account) !== -1
      && this.get_account_balance(account) > mist_op.fee
    ) {
      this.decrease_account_balance(account,mist_op.fee);
      this.db.pending_genesis_confirms.remove(account);

      return true;
    }

    return false;
  },

  add_op: function(mist_op) {
    if(mist_op.type == 'send') {
      return this.add_send(mist_op)
    }

    if(mist_op.type == 'confirmation') {
      return this.add_confirmation(mist_op)
    }

    // this is a genesis confirmation request
    if(mist_op.type == 'genesis_confirm') {
      return this.add_genesis_confirm(mist_op)
    }
  },

  enqueue_for_confirmation: function(mist_op, op) {
    // mist_op is assumed to be valid
    var ident = validator.constIdent(op[1]['author'], op[1]['permlink']),
        to_add = JSON.parse(JSON.stringify(mist_op));

    if(mist_op.type === 'send') {
      to_add.new_from_balance = this.get_account_balance(to_add.from_account);
      to_add.new_to_balance = this.get_account_balance(to_add.to_account);
    }

    if (_.has(this.db.pending_confirmations, [ident, to_add.trxid])) {
      this.pending_confirmations[ident][to_add.trxid] = to_add;
    } else {
      this.db.pending_confirmations[ident] = {};
      this.db.pending_confirmations[ident][to_add.trxid] = to_add;
    }
  },

  remove_pending_confirmation: function(ident, trxid) {
    // Remove confirmation associated with trxid
    if(_.has(this.db.pending_confirmations, [ident, trxid])) {
      delete this.db.pending_confirmations[ident][trxid];
    }

    // then check if the ident can be removed as well:
    if(this.db.pending_confirmations.hasOwnProperty(ident) && this.db.pending_confirmations[ident].length == 0) {
      delete this.db.pending_confirmations[ident];
    }
  },

  get_ops_for_ident: function(parentIdent) {
    if (this.db.pending_confirmations.hasOwnProperty(parentIdent)) {
      return this.db.pending_confirmations[parentIdent];
    }

    return null;
  },

  get_next_confirmation: function() {
    // return exactly one needed confirmation
    if (this.db.pending_confirmations.length > 0) {
      var idents = Object.getOwnPropertyNames(this.db.pending_confirmations),
          ident = idents[Math.floor(Math.random() * idents.length)];

      if (this.db.pending_confirmations[ident].length > 0) {
        var trxids = Object.getOwnPropertyNames(this.db.pending_confirmations[ident]),
            trxid = trxids[Math.floor(Math.random() * trxids.length)];

        return this.db.pending_confirmations[ident][trxid];
      }
    }

    return null;
  },

  is_eligible: function(account) {
    return account in this.db.eligible_accounts.indexOf(account) !== -1;
  },

  increment_comment_count: function(account) {
    // assume that account is not already eligible, but nothing will break if it is.
    if (this.db.pending_accounts.hasOwnProperty(account)) {
      this.db.pending_accounts[account]++;
    } else {
      this.db.pending_accounts[account] = 1;
    }

    if (this.db.pending_accounts[account] >= constants.GENESIS_POSTS_TH) {
      delete this.db.pending_accounts[account];
      this.db.eligible_accounts.push(account);
    }
  },

  get_total_supply: function() {
    var total = 0;
    for(account in this.db.accounts) {
      if (this.db.accounts.hasOwnProperty(account)) {
        var balance = parseInt(this.get_account_balance(account));
        total += balance;
      }
    }

    return total;
  },

  get_top_accounts: function(K) {
    // return list of accounts with K largest balances
    var acctlist = [];
    for(account in this.db.accounts) {
      if (this.db.accounts.hasOwnProperty(account)) {
        acctlist.push([account, this.get_account_balance(account)]);
      }
    }

    acctlist.sort(function(a, b) { return b[1] - a[1] });
    return acctlist.slice(0, K);
  },

  get_bottom_accounts: function(K) {
    // return list of accounts with K lowest balances
    var acctlist = [];
    for(account in this.db.accounts) {
      if (this.db.accounts.hasOwnProperty(account)) {
        acctlist.push([account, this.get_account_balance(account)]);
      }
    }

    acctlist.sort(function(a, b) { return a[1] - b[1] });
    return acctlist.slice(0, K);
  },

  load: function(fname) {
    if (typeof fname === 'undefined') {
      fname = this.dbFname;
    }

    try {
      this.db = JSON.parse(fs.readFileSync(fname, 'utf8'));
    } catch(e) {
      this.log('db.json file missing, loading an empty DB');
      this.reset();
    }
  },

  save: function(fname, data) {
    if (typeof fname === 'undefined') {
      fname = this.dbFname;
    }

    if (typeof data === 'undefined') {
      data = this.db;
    }

    fs.writeFileSync(fname, data);
  },

  reset: function() {
    this.db = {};
    this.db['last_block'] = constants.START_BLOCK - 1;
    this.db['accounts'] = {};
    this.db['pending_confirmations'] = {};
    this.db['pending_accounts'] = {};
    this.db['eligible_accounts'] = [];
    this.db['pending_genesis_confirms'] = [];
    this.db['active'] = false;
    this.db['genesis_active'] = false;
    this.db['genesis_in_block'] = -1;
    this.db['genesis_last_block'] = -1;
    this.save();
  },

  log: function() {
    if (this.outputLogs === false) {
      return;
    }

    var now = new Date();
    if (typeof arguments.unshift === 'undefined') {
      arguments[0] = '[' + now + '] ' + arguments[0];
    } else {
      arguments.unshift(now);
    }
    
    console.log.apply(null, arguments);
  }
};

module.exports = MistDB;