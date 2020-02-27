var util = require("util");
var Rabbus = require("rabbus");
var Config = require('../config');
var EthereumTx = require('ethereumjs-tx');
var ActionsUtility = require('../Core/ActionsUtility');

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}

module.exports = function (Web3, Rabbot) {

    // Web3 Timeout function
    let Web3TimeoutError = "TIMEOUT-ERROR";
    let TimeoutWeb3 = function (ms) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(Web3TimeoutError);
            }, ms)
        });
    };

    // Set transaction Receiver
    var transactionReceiver=null;
    function TransactionReceiver(){
        Rabbus.Receiver.call(this, Rabbot, {
            exchange:  Config.rabbitMQ.exchanges["transactions"],
            queue:  Config.rabbitMQ.queues["transactions"],
            routingKey: Config.network_name
        });
    }
    util.inherits(TransactionReceiver, Rabbus.Receiver);

    //set pending transactions sender
    var pendingTransactionsSender=null;
    function PendingTransactionsSender(){
        Rabbus.Sender.call(this, Rabbot, {
            exchange:  Config.rabbitMQ.exchanges["transactions-pending"],
            routingKey: Config.network_name
        });
    }
    util.inherits(PendingTransactionsSender, Rabbus.Sender);

    //set Action sender
    function ActionSender(key){
        Rabbus.Sender.call(this, Rabbot, {
            exchange:  Config.rabbitMQ.exchanges["actions"],
            routingKey: key
        });
    }
    util.inherits(ActionSender, Rabbus.Sender);

    // Send signed transaction as promise
    let sendSignedTransaction = function (serializedTxHex) {
        return new Promise((resolve, reject) => {
            Web3.eth.sendSignedTransaction(serializedTxHex, async function (error, hash) {
                if (error) reject(error);
                resolve(hash);
            });
        })
    };

    //set Transaction Receiver
    pendingTransactionsSender = new PendingTransactionsSender();

    transactionReceiver = new TransactionReceiver();

    transactionReceiver.receive(async function(message, properties, actionsp, next){

        // Better actions object
        let actions = new ActionsUtility(actionsp);

        try {

            console.log('Received transaction message: ' + message.transactionId);

            if (message !== null) {


                //Check if the transaction is finished
                if(typeof message.sendRetry !== "undefined"){

                    // Get transaction details
                    const trx = await Promise.race([Web3.eth.getTransaction(message.hash), TimeoutWeb3(1000)]);
                    if (trx === Web3TimeoutError) {
                        console.log('  Send Message back to queue transaction : ' + message.transactionId + ' (Timeout web3.getTransaction)');
                        actions.nack();
                        return;
                    }

                    if (trx) {
                        //Send to validate again
                        pendingTransactionsSender.send(message, function(){
                            console.log('  Send transaction to validate: '+ message.transactionId );
                        });
                        actions.ack();
                        return;
                    }
                }

                // Check private key
                if (typeof message.senderPrivateKey === "undefined") {
                    message.event = {name: 'error', params: {}};
                    var actionSender = new ActionSender(message.project);
                    actionSender.send(message, function () {
                        console.log('  Send error action to project: ' + message.transactionId + ' Reject for ever');
                    });
                    console.error("Error in parameters. Sender private key is undefined");
                    actions.reject();
                    return;
                }

                // Check address
                if (typeof message.senderAddress === "undefined") {
                    message.event = {name: 'error', params: {}};
                    var actionSender = new ActionSender(message.project);
                    actionSender.send(message, function () {
                        console.log('  Send error action to project: ' + message.transactionId + ' Reject for ever');
                    });
                    console.error("Error in parameters. Sender address is undefined");
                    actions.reject();
                    return;
                }


              //Check if the destiny address is a contract or not
              let codeResult = await Web3.eth.getCode(message.toAddress);
              if(codeResult === '0x'){
                // is User Account
                message.event = {name: 'error', params: {}};
                var actionSender = new ActionSender(message.project);
                actionSender.send(message, function () {
                  console.log(' Send error action to project: ' + message.transactionId + ' Reject for ever');
                });

                console.error("Transaction Node: The destiny address is not a contract");
                actions.reject();
                return;
              }


                let nonce =null;
                let gasPrice = null;

                try {
                    nonce = await Promise.race([TimeoutWeb3(1000), Web3.eth.getTransactionCount(message.senderAddress, "pending")]);
                    console.log('  Transaction nonce: ' + nonce);
                    if (nonce === Web3TimeoutError) {
                        console.log('  Send transaction back to queue: ' + message.transactionId + ' (Timeout in tx count)');
                        actions.nack();
                        return;
                    }
                    gasPrice = await Promise.race([TimeoutWeb3(1000), Web3.eth.getGasPrice()]);
                    if (gasPrice === Web3TimeoutError) {
                        console.log('  Send transaction back to queue: ' + message.transactionId + ' (Timeout in gas price)');
                        actions.nack();
                        return;
                    }
                }catch (e) {
                    console.error(e);
                }

                var rawTx = {
                    nonce: Web3.utils.toHex(nonce),
                    gasPrice: parseInt(gasPrice), // 0GWei
                    gasLimit: 6500000,
                    to: message.toAddress,
                    value: Web3.utils.toHex(message.value),
                    data: message.data
                };

                //Remove 0x from privateKey if necessary
                if(typeof message.senderPrivateKey !== "undefined" && typeof message.senderPrivateKey === "string" && message.senderPrivateKey.startsWith("0x")){
                    message.senderPrivateKey = message.senderPrivateKey.substring(2, message.senderPrivateKey.length);
                }


                var tx = new EthereumTx(rawTx);
                tx.sign(Buffer.from(message.senderPrivateKey, 'hex'));

                // Serialize transaction
                var serializedTx = tx.serialize();

                /**
                 * Send transaction
                 */
                try {
                    let hash = await Promise.race([TimeoutWeb3(1000), sendSignedTransaction('0x' + serializedTx.toString('hex'))]);

                    if (hash === Web3TimeoutError) {
                        // Web3 Timeout
                        console.log('  Send transaction back to queue: ' + message.transactionId + ' (Timeout in send transaction)');
                        actions.nack();
                        return;
                    }

                    /**
                     * Transaction Hash
                     */

                    message.hash = hash;
                    message.event = {name:'hash', params:{'hash': hash}};

                    pendingTransactionsSender.send(message, function(){
                        console.log('  Send transaction to validate: '+ message.transactionId );
                    });

                    var actionSender = new ActionSender(message.project);
                    actionSender.send(message, function(){
                        console.log('  Send hash action to project: '+ message.project + ' ' + message.transactionId );
                    });

                    actions.ack();
                } catch (error) {

                    /**
                     * Error
                     */

                    if (typeof error.message !== "undefined" && error.message.indexOf("the tx doesn't have the correct nonce") !== -1) {
                        // Nonce error, wait nod emining time
                        console.log('  Send transaction back to queue: ' + message.transactionId + ' (Nonce error)');
                        await sleep(Config.mining_time);
                        actions.nack();
                    } else if(typeof error.message !== "undefined") {
                        var canRetry = error.message.indexOf("is not a contract address") < 0;

                        if (canRetry) {
                            console.log('  Send transaction back to queue: ' + message.transactionId + ' (' + error.message + ') with price: ' + message.value);
                            actions.nack();
                        } else {
                            message.event = {name: 'error', params: {}};
                            var actionSender = new ActionSender(message.project);
                            actionSender.send(message, function () {
                                console.log('  Send error action to project: ' + message.transactionId + ' Reject for ever');
                            });
                            console.error("Error in transaction: " + error.message);
                            console.error(error);
                            actions.reject();
                        }

                    } else if (typeof error.error !== "undefined" && typeof error.error.message !== "undefined"){

                        //Timeout exceeded during the transaction confirmation process. Be aware the transaction could still get confirmed!
                        if(error.error.message.indexOf("Timeout exceeded during the transaction confirmation process") >= 0){
                            message.event = {name: 'error', params: {}};
                            var actionSender = new ActionSender(message.project);
                            actionSender.send(message, function () {
                                console.log('  Send error action to project: ' + message.transactionId + ' Reject for ever');
                            });
                            console.error("Error in transaction: " + message.transactionId + " Error: " + error.error.message);
                            actions.reject();
                        }else{
                            console.log('  Send transaction back to queue (error): ' + message.transactionId + ' Retry later');
                            console.error("Error in transaction: " + message.transactionId + " Error: " + error.error.message);
                            console.error(error);
                            actions.nack();
                        }

                    }else{

                        console.log('  Send transaction back to queue (error): ' + message.transactionId + ' Retry later');
                        console.error("Error in transaction: " + message.transactionId + " Error: unknown");
                        console.error(error);
                        actions.nack();
                    }
                }

            }


        } catch (error) {

            console.log('  Send transaction back to queue (error): ' + message.transactionId + ' Retry later');
            console.error("Error unexpected processing the transaction message: " + message.transactionId);
            console.error(error);
            actions.nack();

        } finally {

        }


    });


};
