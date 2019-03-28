const rp = require('request-promise');
const tools = require('./tools');

const jussi = {
  getBlocks: function(fromBlockNumber = 1, maxBatchSize = 50, batchNumber = 4) {
    return new Promise(function(resolve, reject) {
      const promises = [];
      let requestBody;
      let blockNumber = parseInt(fromBlockNumber);

      for (let bi=0; bi<batchNumber; bi++) {
        requestBody = [];

        for(let ri=0; ri<maxBatchSize; ri++) {
          requestBody.push({jsonrpc: "2.0", method: "condenser_api.get_block", params: [blockNumber], id: `${bi}-${ri}`});
          blockNumber++;
        }

        const options = {
          method: 'POST',
          uri: 'https://api.steemit.com',
          body: requestBody,
          json: true,
        };

        promises.push(rp(options));
      }

      tools.settlePromises(promises)
        .then(function (results) {
          const blocks = [];

          for (let ri=0; ri<results.length; ri++) {
            const result = results[ri];
            if (result.state === 'resolved') {
              const response = result.value;

              if (response.hasOwnProperty('error')) {
                reject(response.error);
              } else {
                for(let ri=0; ri<response.length; ri++) {
                  const result = response[ri];
                  blocks.push(result.result);
                }
              }
            } else {
              reject(result.value);
            }
          }

          resolve(blocks);
        })
        .catch(function(err) {
          reject(err);
        });
    });
  }
};

module.exports = jussi;