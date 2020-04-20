/**
 * returns the input array without duplicate elements
 * @param {*[]} array an array
 * @return {*[]} the same array without ducplicate elements
 */
const allElementsOnlyOnce = function(array) {
  return array.filter((value, index, self) => self.indexOf(value) === index)
}

/**
 * checks whether the two input arrays are the same up to reordering elements
 * @param {*[]} array1 an array
 * @param {*[]} array2 another array
 * @return {bool} whether the two arrays are the same up to order
 */
const equalUpToOrder = function(array1, array2) {
  if (array1.length != array2.length) return false
  const array1ShallowCopySorted = array1.slice().sort()
  const array2ShallowCopySorted = array2.slice().sort()
  for (let index = 0; index < array1.length; index++)
    if (array1ShallowCopySorted[index] !== array2ShallowCopySorted[index]) return false
  return true
}

/**
 * js-sleep promise to pause scripts
 */
const sleep = function(milliseconds) {
  return new Promise(r => setTimeout(r, milliseconds))
}

module.exports = {
  allElementsOnlyOnce,
  equalUpToOrder,
  sleep,
}
