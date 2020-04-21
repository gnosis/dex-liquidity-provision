/**
 * returns the input array without duplicate elements
 * @param {*[]} array an array
 * @return {*[]} the same array without ducplicate elements
 */
const allElementsOnlyOnce = function(array) {
  return array.filter((value, index, self) => self.indexOf(value) === index)
}

/**
 * js-sleep promise to pause scripts
 */
const sleep = function(milliseconds) {
  return new Promise(r => setTimeout(r, milliseconds))
}

module.exports = {
  allElementsOnlyOnce,
  sleep,
}
