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
 * Helper function for returnFirstNotErroring. Returns a promise that
 * resolves to the value of the earliest input promise to resolve, or
 * rejects with a combined error if both promises reject.
 *
 * @param {Promise} combinedPromises promise combining other promises
 * with the same logic as in this function
 * @param {Promise} appendedPromise promise to add to combinedPromises
 * @returns {Promise} timeout
 */
const appendPromise = (combinedPromises, appendedPromise) =>
  new Promise((resolve, reject) => {
    let combinedIsCaught = false
    let combinedErrors
    let appendedIsCaught = false
    let appendedError
    appendedPromise
      .then((result) => resolve(result))
      .catch((error) => {
        appendedError = error.message || error
        if (combinedIsCaught) {
          reject(new Error(appendedError + " && " + combinedErrors))
        } else {
          appendedIsCaught = true
        }
      })
    combinedPromises
      .then((result) => resolve(result))
      .catch((error) => {
        combinedErrors = error.message || error
        if (appendedIsCaught) {
          reject(new Error(appendedError + " && " + combinedErrors))
        } else {
          combinedIsCaught = true
        }
      })
  })

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
 * Behaviors that might be unexpected:
 * 1. Unlike Promise.any, if all input promises reject then the return
 *    value is a rejected promise returning an error with a message that
 *    concatenates all promise error messages (or output values, if
 *    message is not available) in the order they appear in the input
 *    array. (Promise.any returns an AggregateError.)
 * 2. Even if all input promises are already resolved, the output is
 *    a pending promise
 *
 * @param {Promise[]} promiseArray array of promises (or values)
 * @returns {Promise} promise returning the value returned by the
 * input promise that is the quickest to resolve
 */
const returnFirstNotErroring = function (promiseArray) {
  try {
    if (promiseArray.length === 0) {
      return Promise.reject()
    }
    let combinedPromises = Promise.resolve(promiseArray[promiseArray.length - 1])
    for (const promise of promiseArray.slice(0, -1).reverse()) {
      combinedPromises = appendPromise(combinedPromises, Promise.resolve(promise))
    }
    return combinedPromises
  } catch (error) {
    return Promise.reject(error)
  }
}

module.exports = {
  uniqueItems,
  sleep,
  returnFirstNotErroring,
}
