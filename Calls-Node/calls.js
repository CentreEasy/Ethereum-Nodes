var util = require("util");
var Rabbus = require("rabbus");
var Config = require('../config');
var ActionsUtility = require('../Core/ActionsUtility');

module.exports = async function (Web3, Rabbot) {


/*
try {

    var ismining = await Web3.eth.isMining();
    var islistenning = await Web3.eth.net.isListening();
    var perscount = await Web3.eth.net.getPeerCount();

}catch (e) {
    console.log(e);
}

    Web3.eth.isSyncing(function(error, sync){
        if(!error) {
            // stop all app activity
            if(sync === true) {
                // we use `true`, so it stops all filters, but not the web3.eth.syncing polling

                Web3.setProvider(Web3.currentProvider);
                // show sync info
            } else if(sync) {
                console.log(sync.currentBlock);

                // re-gain app operation
            } else {
                // run your app init function...
            }
        }else{
            var a= error
        }
    });
*/

    async function isBlockchainSynchronized() {
        try {
            const sync = await Web3.eth.isSyncing();
            const isListening = await Web3.eth.net.isListening();
            return sync === false && isListening === true;
        } catch (e) {
            return false;
        }
    }

    // Set Action sender
    function CallResponder(){
        Rabbus.Responder.call(this, Rabbot, {
            exchange:  Config.rabbitMQ.exchanges.calls,
            queue:  Config.rabbitMQ.queues.calls,
            routingKey: Config.network_name
        });
    }

    util.inherits(CallResponder, Rabbus.Responder);

    // Set Transaction Receiver
    var callResponder = new CallResponder();

    // basic error handler
    callResponder.use(function(err, msg, props, actions, next){
        setTimeout(
            function(){
                throw err;
            });
    });

    // Main handler
    callResponder.handle(async function (message, properties, actionsp, next) {
        let actions = new ActionsUtility(actionsp);

        try {

            if(Date.now() - properties.timestamp > Config.calls.timeout){
                console.log("Rejected call for timeout");
                return actions.reject();
            }

            console.log("Received call message");

            // Check if the Blockchain is Synchronizing or not
            const sync = await isBlockchainSynchronized();
            if (!sync){
                console.log("  Blockchain not synchronized!");
                return actions.nack();
            }

            // Check if the destiny address is a contract or not
            let codeResult = await Web3.eth.getCode(message.to);
            if(codeResult === '0x'){
                // is User Account
                console.error("Calls Node: The destiny address is not a contract");
                return actions.reject();
            }
            console.log("Checked that destiny address is a contract");

            let response = await Web3.eth.call(message);
            console.log("  Request: " + JSON.stringify(message));
            console.log("  Response: " + JSON.stringify(response));
            actions.reply(response);
        } catch (e) {
            console.log("  Error in call. Retry other");
            console.error(e);
            actions.nack();
        } finally {

        }
    });

};
