var util = require("util");
var Rabbus = require("rabbus");
var Config = require('../config');
const {ErrorWeb3} = require('easy-ethereum-client');
var ActionsUtility = require('../Core/ActionsUtility');

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

    async function getConfirmations(txHash, transactionId) {
        // Get transaction details
        const trx = await Promise.race([Web3.eth.getTransaction(txHash), TimeoutWeb3(1000)]);
        if (trx === Web3TimeoutError) {
            console.log('  Send validate back to queue: ' + transactionId + ' (Timeout web3.getTransaction)');
            return {n: -1};
        }

        if (!trx) {
            throw new ErrorWeb3("Transaction doesn't exist in the blockchain", ErrorWeb3.TRANSACTION_NOT_EXIST);
        }

        const trxReceipt = await Promise.race([Web3.eth.getTransactionReceipt(txHash), TimeoutWeb3(1000)]);
        if (trxReceipt === Web3TimeoutError) {
            console.log('  Send validate back to queue: ' + transactionId + ' (Timeout web3.getTransactionReceipt)');
            return -{n: -1};
        }

        //If trxReceipt is null, that mean that is pending to be mined. So i will generate and error and resend it to the queue
        if (trxReceipt === null) {
            throw new ErrorWeb3(
                "Transaction not mined, but in the blockchain stay in the pending queue",
                ErrorWeb3.TRANSACTION_PENDING_IN_QUEUE);
        }

        //When trxReceipt has a value, we can check the status, if is false it generates and error and remove it from the queue
        if (trxReceipt.blockNumber != null && (!trxReceipt.status || trxReceipt.gasUsed >= 6500000)) {
            throw new ErrorWeb3("Invalid transaction", ErrorWeb3.TRANSACTION_ERROR);
        }

        // Get current block number
        const currentBlock = await Promise.race([Web3.eth.getBlockNumber(), TimeoutWeb3(1000)]);
        if (currentBlock === Web3TimeoutError) {
            console.log('  Send validate back to queue: ' + transactionId + ' (Timeout web3.getBlockNumber)');
            return {n: -1};
        }

        // Get transaction events
        const logs = (trxReceipt.logs && trxReceipt.logs.length > 0) ? trxReceipt.logs : null;

        // When transaction is unconfirmed, its block number is null.
        // In this case we return 0 as number of confirmations
        return {
            n: trx.blockNumber === null ? 0 : currentBlock - trx.blockNumber,
            logs: logs
        }
    }

    function confirmEtherTransaction(message, confirmations = Config.validate.confirmations) {
        return new Promise(async (resolve, reject) => {
            try {
                const trxConfirmationResult = await getConfirmations(message.hash, message.transactionId, message);
                const trxConfirmations = trxConfirmationResult.n;

                // //Check if the process has to emit the action event
                if(trxConfirmations > 0 && typeof message.firstValidation === "undefined"){
                    //Change message object
                    message.firstValidation = true;

                    //Check if the process has to emit the action event
                    let messageFirstValidation = JSON.parse(JSON.stringify(message));

                    console.log('  Send event firstValidation to project: '+ messageFirstValidation.project + ' ' + messageFirstValidation.transactionId );
                    messageFirstValidation.event = {name:'firstValidation', params:{'hash': messageFirstValidation.hash}};
                    messageFirstValidation.firstValidation = true;

                    var actionSender = new ActionSender(messageFirstValidation.project);
                    actionSender.send(messageFirstValidation, function(){
                        console.log('  Sender event firstValidation to project: '+ messageFirstValidation.project + ' ' + messageFirstValidation.transactionId );
                    });
                }

                if (trxConfirmations === -1) {
                    // Timeout in web3 calls
                    resolve({
                        result: Web3TimeoutError,
                        logs: trxConfirmationResult.logs
                    });
                } else if (trxConfirmations >= confirmations) {
                    // Handle confirmation event according to your business logic
                    resolve({
                        result: "Done",
                        logs: trxConfirmationResult.logs
                    });
                } else {
                    // Recursive call, sleep mining time
                    await sleep(Config.mining_time);
                    resolve(await confirmEtherTransaction(message, confirmations));
                }

            } catch (e) {
                if (typeof e.code !== "undefined" && (e.code === ErrorWeb3.TRANSACTION_PENDING_IN_QUEUE)) {
                    await sleep(Config.mining_time);
                    reject(e);
                } else {
                    reject(e);
                }
            }
        });
    }

    // Set transaction Receiver
    var transactionPendingReceiver = null;

    function TransactionPendingReceiver() {
        Rabbus.Receiver.call(this, Rabbot, {
            exchange: Config.rabbitMQ.exchanges["transactions-pending"],
            queue: Config.rabbitMQ.queues["transactions-pending"],
            routingKey: Config.network_name
        });
    }

    util.inherits(TransactionPendingReceiver, Rabbus.Receiver);

    //set Action sender
    function ActionSender(key) {
        Rabbus.Sender.call(this, Rabbot, {
            exchange: Config.rabbitMQ.exchanges["actions"],
            routingKey: key
        });
    }
    util.inherits(ActionSender, Rabbus.Sender);


    function TransactionsSender(){
        Rabbus.Sender.call(this, Rabbot, {
            exchange:  Config.rabbitMQ.exchanges["transactions"],
            routingKey: Config.network_name
        });
    }
    util.inherits(TransactionsSender, Rabbus.Sender);

    function sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }

    var transactionSender = new TransactionsSender();

    transactionPendingReceiver = new TransactionPendingReceiver();

    transactionPendingReceiver.receive(async function (message, properties, actionsp, next) {
        // Better actions object
        let actions = new ActionsUtility(actionsp);
        var actionSender = new ActionSender(message.project);
        try {

            console.log('Received validate message: ' + message.transactionId);

            // check transaction confirmation
            confirmEtherTransaction(message, Config.validate.confirmations)
                .then(({result, logs}) => {

                    if (result && result === Web3TimeoutError) {

                        /**
                         * Web3 Timeout, return to queue
                         */
                        actions.nack();


                    } else {
                        /**
                         * Transaction confirmed
                         */
                        message.event = {name: 'validated', params: {'hash': message.hash}};
                        message.logs = logs;

                        actionSender.send(message, function () {
                            console.log('  Send complete action to project: ' + message.project + " (" + message.transactionId + ")");
                        });
                        actions.ack();

                    }

                })
                .catch(async (error) => {
                    if (typeof error.code !== "undefined" && error.code === ErrorWeb3.TRANSACTION_ERROR) {

                        // send action error
                        message.event = {name: 'error', params: {}};
                        actionSender.send(message, function () {
                            console.log('  Send error action to project: ' + message.project + " (" + message.transactionId + ") 1");
                        });

                        // Reject for ever
                        console.error(error);
                        actions.reject();

                    } else if (typeof error.code !== "undefined" && error.code === ErrorWeb3.TRANSACTION_NOT_EXIST) {

                        if (new Date() - properties.timestamp < 5000) {
                            // not found yet, retry for 5 seconds
                            console.log('  The transaction does not exist but is only ' + (new Date() - properties.timestamp) + " miliseconds old. Retry later (" + message.transactionId + ")");
                            await sleep(1000);
                            actions.nack();
                        } else {

                            //Check If message has the option retry
                            if(typeof message.sendRetry === "undefined"){
                                message.sendRetry = 0;
                            }

                            if(message.sendRetry < Config.max_number_retries){
                                message.sendRetry++;

                                transactionSender.send(message, function () {
                                    console.log('  Send the transaction to the Transaction Queue again: ' + message.project + " (" + message.transactionId + "). Number of replies: " + message.sendRetry);
                                });

                            }else{
                                // we tried enough times and send action error
                                message.event = {name: 'error', params: {}};
                                actionSender.send(message, function () {
                                    console.log('  Send error action to project: ' + message.project + " (" + message.transactionId + ") 1");
                                });
                            }


                            // Always reject for ever
                            console.error(error);
                            actions.reject();
                        }

                    } else if (typeof error.code !== "undefined" && error.code === ErrorWeb3.TRANSACTION_PENDING_IN_QUEUE) {
                        // Resend to the queue
                        console.log('  Send validate back to queue (still pending): ' + message.transactionId);
                        actions.nack();
                    } else {
                        // Resend to the queue
                        console.log('  Send validate back to queue: ' + message.transactionId);
                        console.error(error);
                        actions.nack();
                    }
                });

        } catch (error) {

            // Send action error
            message.event = {name: 'error', params: {}};
            actionSender.send(message, function () {
                console.log('  Send error action to project: ' + message.project + " (" + message.transactionId + ") 2");
            });

            // Reject for ever
            actions.reject();

            console.error(error);

        } finally {

        }

    });
};
