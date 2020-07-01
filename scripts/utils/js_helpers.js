/**
 * returns the input array without duplicate elements
 *
 * @param {*[]} array an array
 * @returns {*[]} the same array without ducplicate elements
 */
const uniqueItems = function (array) {
  return array.filter((value, index, self) => self.indexOf(value) === index)
}

/**
 * js-sleep promise to pause scripts
 *
 * @param {number} milliseconds number of miliseconds to sleep.
 * @returns {Promise} timeout
 */
const sleep = function (milliseconds) {
  return new Promise((r) => setTimeout(r, milliseconds))
}

/**
 * Given an array of promises, returns a promise resolving to the
 * output of the first resolving promise of the array. If any promise
 * has been rejected in the meantime, this failure is ignored. If all
 * promises are rejected, returns a rejecting promise returning an
 * error containing all error messages concatenated with "&&".
 * If entries of the input array are not promises, they will be treated
 * as promises resolving to the input value.
 *
 * This function is meant to be replaced in the future by Promise.any,
 * which is not yet availeble on Node.js.
 * https://tc39.es/proposal-promise-any/#sec-promise.any
 *
 * Unlike Promise.any, if all input promises reject then the return
 * value is a rejected promise returning an error with a message that
 * concatenates all promise error messages (or output values, if
 * message is not available) in the order they appear in the input
 * array. (Promise.any returns an AggregateError.)
 *
 * @param {Promise[]} promiseArray array of promises (or values)
 * @returns {Promise} promise returning the value returned by the
 * input promise that is the quickest to resolve
 */
const returnFirstNotErroring = (promiseArray) =>
  new Promise((resolve, reject) => {
    let resolved = false
    const errorPromises = []
    for (const promise of promiseArray) {
      errorPromises.push(
        Promise.resolve(promise).then(
          (result) => {
            resolved = true
            // only the first call to resolve() determines the outer promise output
            resolve(result)
          },
          (error) => error
        )
      )
    }
    Promise.all(errorPromises).then((errorArray) => {
      if (!resolved) {
        let errorString = ""
        errorArray.forEach((error) => {
          errorString += " && " + String(error.message || error)
        })
        reject(new Error(errorString.slice(4)))
      }
    })
  })

module.exports = {
  uniqueItems,
  sleep,
  returnFirstNotErroring,
}
