
class ActionsUtility {

    constructor(actions) {
        this.actions = actions;
        this.done = false;
    }

    ack(){
        if (!this.done) {
            this.actions.ack();
        }
        this.done = true;
    }

    nack(){
        if (!this.done) {
            this.actions.nack();
        }
        this.done = true;
    }

    reply(response){
        if (!this.done) {
            this.actions.reply(response);
        }
        this.done = true;
    }

    reject(){
        if (!this.done) {
            this.actions.reject();
        }
        this.done = true;
    }
}

module.exports = ActionsUtility;