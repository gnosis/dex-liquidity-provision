// https://github.com/ethereum/web3.js/issues/1446

module.exports = function (web3) {
  class BatchRequest {
    constructor() {
      this.promises = []
      this.batch = new web3.BatchRequest()
    }

    add(call, ...params) {
      this.promises.push(
        new Promise((resolve, reject) => {
          const request = call.request(...params, (error, data) => {
            if (error) {
              reject(error)
            } else {
              resolve(data)
            }
          })
          this.batch.add(request)
        })
      )
    }

    execute() {
      this.batch.execute()
      return this.promises
    }
  }

  return BatchRequest
}
