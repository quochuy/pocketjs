function define(name, value) {
  Object.defineProperty(exports, name, {
    value:      value,
    enumerable: true
  });
}

const tokenName = 'pocket';
const genesisAccount = 'biophil';
const genesisPermlink = 'genesis-' + tokenName;

define("START_BLOCK", 1);
define("GENESIS_INTERVAL", (14*24*60)*20); // 14 days, 20 blocks/minute);
define("GENESIS_ACCOUNT", genesisAccount);
define("GENESIS_POSTS_TH", 5);
define("GENESIS_CREDIT", 1000001);
define("TOKEN_NAME", tokenName);
define("SAVE_INTERVAL", 10*20); // 10 minutes, 20 blocks/minute
define("GRAPHENE_DATE_FORMAT_STRING", '%Y-%m-%dT%H:%M:%S');
define("FEE", 1);
define("GENESIS_PERMLINK", genesisPermlink);
define("GENESIS_IDENTIFIER", '@' + genesisAccount + '/' + genesisPermlink);
